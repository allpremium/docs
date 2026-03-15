#!/usr/bin/env node
/**
 * apply-brand.js — stamp brand-specific values into Mintlify MDX files,
 *                  docs.json, mint.json, and style.css (logo/card primary color).
 *
 * Usage:
 *   node apply-brand.js tupay          (local / npm script)
 *   BRAND=milele node apply-brand.js   (Docker: docker run -e BRAND=milele ...)
 *
 * The script is idempotent: it normalises any previously-applied brand values
 * back to placeholders before applying the target brand, so you can switch
 * brands freely without needing to reset from git.
 *
 * Source MDX files use "Tupay" / "https://api.tupay.africa" etc. as the
 * canonical placeholder values — the Tupay brand is the template.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;

// ── 1. Resolve target brand ───────────────────────────────────────────────────

const brand = process.argv[2] || process.env.BRAND;
if (!brand) {
  console.error('Usage: node apply-brand.js <brand>   (e.g. tupay | milele)');
  console.error('       or:  BRAND=milele node apply-brand.js');
  process.exit(1);
}

const brandFile = path.join(ROOT, `brand-${brand}.json`);
if (!fs.existsSync(brandFile)) {
  console.error(`Brand file not found: ${brandFile}`);
  process.exit(1);
}

const target = JSON.parse(fs.readFileSync(brandFile, 'utf-8'));

// ── 2. Load Tupay (canonical) brand for reverse-map ───────────────────────────
//    Source files are kept as "Tupay / tupay.africa" values.
//    We first restore any previously-applied brand back to Tupay, then apply
//    the target brand — making the operation idempotent.

const tupayFile = path.join(ROOT, 'brand-tupay.json');
const canonical = JSON.parse(fs.readFileSync(tupayFile, 'utf-8'));

// ── 3. Build ordered replacement pairs ───────────────────────────────────────
//    Longer / more-specific strings must come before shorter ones.

function buildPairs(from, to) {
  return [
    [from.apiKeysUrl,   to.apiKeysUrl],
    [from.dashboardUrl, to.dashboardUrl],
    [from.baseUrl,      to.baseUrl],
    [from.website,      to.website],
    [from.name,         to.name],
  ].filter(([a, b]) => a && b && a !== b);
}

// Step 1: revert any previously-applied brand back to canonical (Tupay)
// Step 2: apply canonical → target
// We load ALL brand files so we can revert from any brand.
const allBrandFiles = fs.readdirSync(ROOT).filter(f => /^brand-.+\.json$/.test(f));
const allBrands = allBrandFiles.map(f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf-8')));

// Regex matching {/* brand:tupay:start */} ... {/* brand:tupay:end */} blocks
// including the surrounding blank lines so no double-blank-lines are left behind.
const TUPAY_BLOCK_RE = /\n?\{\/\* brand:tupay:start \*\/\}\n([\s\S]*?)\n\{\/\* brand:tupay:end \*\/\}\n?/g;

function applyBrandBlocks(content, isTupay) {
  if (isTupay) {
    // Keep the content, strip only the marker comments
    return content.replace(TUPAY_BLOCK_RE, '\n$1\n');
  } else {
    // Remove the entire block including its content
    return content.replace(TUPAY_BLOCK_RE, '\n');
  }
}

function transform(content) {
  // Revert: any known brand value → canonical Tupay value
  for (const b of allBrands) {
    if (b.name === canonical.name) continue; // skip Tupay itself
    for (const [from, to] of buildPairs(b, canonical)) {
      content = content.split(from).join(to);
    }
  }
  // Apply: canonical Tupay value → target brand value
  for (const [from, to] of buildPairs(canonical, target)) {
    content = content.split(from).join(to);
  }
  // Show/hide brand-specific blocks
  content = applyBrandBlocks(content, brand === 'tupay');
  return content;
}

// ── 4. Walk and patch *.mdx files ─────────────────────────────────────────────

function walkMdx(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walkMdx(full);
    } else if (entry.endsWith('.mdx')) {
      const original = fs.readFileSync(full, 'utf-8');
      const updated  = transform(original);
      if (updated !== original) {
        fs.writeFileSync(full, updated);
        console.log(`  patched  ${full.replace(ROOT + '/', '')}`);
      }
    }
  }
}

console.log(`\nApplying brand: ${target.name}`);
console.log('── MDX files ────────────────────────────────');
walkMdx(ROOT);

// ── 5. Patch docs.json ────────────────────────────────────────────────────────

const docsPath = path.join(ROOT, 'docs.json');
if (fs.existsSync(docsPath)) {
  console.log('── docs.json ────────────────────────────────');
  const docs = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));

  docs.name = target.name;

  if (typeof docs.logo === 'object' && docs.logo !== null) {
    docs.logo.href = target.website;
  }

  docs.colors = {
    primary: target.primaryColor,
    light:   target.lightColor,
    dark:    target.darkColor,
  };

  if (!docs.navbar) docs.navbar = {};
  docs.navbar.links = [{ label: 'Dashboard', href: target.dashboardUrl }];
  if (!docs.navbar.primary) docs.navbar.primary = { type: 'button' };
  docs.navbar.primary.label = 'Get API Keys';
  docs.navbar.primary.href  = target.apiKeysUrl;

  if (!docs.footer) docs.footer = {};
  docs.footer.socials = {
    website:  target.website,
    x:        target.twitter,
    linkedin: target.linkedin,
  };

  fs.writeFileSync(docsPath, JSON.stringify(docs, null, 2) + '\n');
  console.log('  patched  docs.json');
}

// ── 6. Logo: copy brand-specific SVGs or patch canonical (Tupay) ──────────────
//    Logo SVGs include the wordmark (brand name) so the name appears in the header.
//    Brand JSON can set logoDark and logoLight (paths relative to ROOT). If both
//    exist, they are copied to logo/dark.svg and logo/light.svg. Otherwise we
//    copy canonical (Tupay) logos and patch name + primary color.

const logoDir = path.join(ROOT, 'logo');
const logoFiles = ['dark.svg', 'light.svg'];

function patchSvgColor(content) {
  for (const b of allBrands) {
    if (b.name === canonical.name) continue;
    if (b.primaryColor) content = content.split(b.primaryColor).join(canonical.primaryColor);
  }
  return content.split(canonical.primaryColor).join(target.primaryColor);
}

function patchSvgNameAndColor(content) {
  for (const b of allBrands) {
    if (b.name === canonical.name) continue;
    if (b.primaryColor) content = content.split(b.primaryColor).join(canonical.primaryColor);
    content = content.split(b.name).join(canonical.name);
  }
  content = content.split(canonical.primaryColor).join(target.primaryColor);
  content = content.split(canonical.name).join(target.name);
  return content;
}

function copyLogo(sourceRel, destFile) {
  const src = path.join(ROOT, sourceRel);
  const dest = path.join(logoDir, destFile);
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

// Favicon: copy brand-specific favicon to logo/favicon.svg (docs/mint point to /logo/favicon.svg)
if (fs.existsSync(logoDir)) {
  const faviconSource = target.favicon || canonical.favicon || 'logo/tupay/favicon.svg';
  const faviconSrc = path.join(ROOT, faviconSource);
  const faviconDest = path.join(logoDir, 'favicon.svg');
  if (fs.existsSync(faviconSrc)) {
    fs.copyFileSync(faviconSrc, faviconDest);
    if (!target.favicon) {
      const content = fs.readFileSync(faviconDest, 'utf-8');
      const patched = patchSvgColor(content);
      if (patched !== content) fs.writeFileSync(faviconDest, patched);
    }
    console.log('── favicon ─────────────────────────────────');
    console.log(`  copied   ${faviconSource} → logo/favicon.svg`);
  }
}

if (fs.existsSync(logoDir)) {
  const hasCustomLogos = target.logoDark && target.logoLight &&
    copyLogo(target.logoDark, 'dark.svg') &&
    copyLogo(target.logoLight, 'light.svg');
  if (hasCustomLogos) {
    console.log('── logo SVGs ──────────────────────────────');
    console.log(`  copied   ${target.logoDark} → logo/dark.svg`);
    console.log(`  copied   ${target.logoLight} → logo/light.svg`);
  } else {
    const canonDark = canonical.logoDark || 'logo/tupay/dark.svg';
    const canonLight = canonical.logoLight || 'logo/tupay/light.svg';
    const copied = copyLogo(canonDark, 'dark.svg') && copyLogo(canonLight, 'light.svg');
    if (copied) {
      const patched = [];
      for (const file of logoFiles) {
        const p = path.join(logoDir, file);
        let content = fs.readFileSync(p, 'utf-8');
        const updated = patchSvgNameAndColor(content);
        if (updated !== content) {
          fs.writeFileSync(p, updated);
          patched.push(`logo/${file}`);
        }
      }
      if (patched.length) {
        console.log('── logo SVGs ──────────────────────────────');
        patched.forEach(f => console.log(`  patched  ${f}`));
      }
    }
  }
}

// ── 7. Patch style.css (--brand-primary + card rgba) ─────────────────────────

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

const stylePath = path.join(ROOT, 'style.css');
if (fs.existsSync(stylePath) && target.primaryColor) {
  const rgb = hexToRgb(target.primaryColor);
  if (rgb) {
    console.log('── style.css ───────────────────────────────');
    let css = fs.readFileSync(stylePath, 'utf-8');
    css = css.replace(/(:root\s*\{\s*--brand-primary:\s*)#[0-9a-fA-F]+(\s*;\s*\})/, `$1${target.primaryColor}$2`);
    css = css.replace(/\brgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/g, (_, a) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`);
    fs.writeFileSync(stylePath, css);
    console.log('  patched  style.css');
  }
}

// ── 8. Patch mint.json ────────────────────────────────────────────────────────

const mintPath = path.join(ROOT, 'mint.json');
if (fs.existsSync(mintPath)) {
  console.log('── mint.json ────────────────────────────────');
  const mint = JSON.parse(fs.readFileSync(mintPath, 'utf-8'));

  mint.name = target.name;

  if (typeof mint.logo === 'object' && mint.logo !== null) {
    mint.logo.href = target.website;
  }

  mint.colors = mint.colors || {};
  mint.colors.primary = target.primaryColor;
  mint.colors.light = target.lightColor;
  mint.colors.dark = target.darkColor;
  if (mint.colors.anchors) {
    mint.colors.anchors = { from: target.primaryColor, to: target.darkColor };
  }

  mint.topbarLinks = [{ name: 'Dashboard', url: target.dashboardUrl }];
  mint.topbarCtaButton = { name: 'Get API Keys', url: target.apiKeysUrl };

  mint.footerSocials = {
    website: target.website,
    twitter: target.twitter,
    linkedin: target.linkedin,
  };

  fs.writeFileSync(mintPath, JSON.stringify(mint, null, 2) + '\n');
  console.log('  patched  mint.json');
}

// ── 9. Write .brand.lock ──────────────────────────────────────────────────────

fs.writeFileSync(path.join(ROOT, '.brand.lock'), brand);
console.log(`\nDone. Brand lock: ${brand}\n`);
