#!/usr/bin/env node
/**
 * apply-brand.js — stamp brand-specific values into all Mintlify MDX files
 *                  and docs.json.
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

// ── 6. Write .brand.lock ──────────────────────────────────────────────────────

fs.writeFileSync(path.join(ROOT, '.brand.lock'), brand);
console.log(`\nDone. Brand lock: ${brand}\n`);
