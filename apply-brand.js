#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const brandFile = process.env.BRAND ? `brand-${process.env.BRAND}.json` : 'brand.json';
const brand = JSON.parse(fs.readFileSync(path.join(__dirname, brandFile), 'utf8'));

// ── 1. Patch mint.json ──────────────────────────────────────────────────────
const mintPath = path.join(__dirname, 'mint.json');
const mint = JSON.parse(fs.readFileSync(mintPath, 'utf8'));

mint.name                 = brand.name;
mint.colors.primary       = brand.primaryColor;
mint.colors.light         = brand.lightColor;
mint.colors.dark          = brand.darkColor;
if (mint.colors.anchors) {
    mint.colors.anchors.from = brand.primaryColor;
    mint.colors.anchors.to   = brand.darkColor;
}
mint.topbarLinks[0].name  = 'Dashboard';
mint.topbarLinks[0].url   = brand.dashboardUrl;
mint.topbarCtaButton.url  = brand.apiKeysUrl;
mint.footerSocials = {
    website:  brand.website,
    twitter:  brand.twitter,
    linkedin: brand.linkedin,
};

fs.writeFileSync(mintPath, JSON.stringify(mint, null, 2) + '\n');
console.log('[brand] mint.json patched');

// ── 1b. Patch CSS brand colors ───────────────────────────────────────────────
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
const [r, g, b] = hexToRgb(brand.primaryColor);
const cssPath = path.join(__dirname, 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');
css = css.replace(/--brand-primary:\s*#[0-9a-fA-F]{6}/, `--brand-primary: ${brand.primaryColor}`);
css = css.replace(/rgba\(\d+,\s*\d+,\s*\d+,\s*0\.06\)/g, `rgba(${r}, ${g}, ${b}, 0.06)`);
css = css.replace(/rgba\(\d+,\s*\d+,\s*\d+,\s*0\.25\)/g, `rgba(${r}, ${g}, ${b}, 0.25)`);
css = css.replace(/rgba\(\d+,\s*\d+,\s*\d+,\s*0\.12\)/g, `rgba(${r}, ${g}, ${b}, 0.12)`);
fs.writeFileSync(cssPath, css);
console.log('[brand] style.css patched');

// ── 2. Replace URLs in all .mdx files ──────────────────────────────────────
// Order matters: more-specific URLs must be replaced before less-specific ones.
// Also replaces the card color token so intro cards use the brand primary color.
const urlMap = [
    ['https://api.tupay.africa',               brand.baseUrl],
    ['https://tupay.africa/dashboard/settings', brand.apiKeysUrl],
    ['https://tupay.africa/dashboard',          brand.dashboardUrl],
    ['https://tupay.africa',                    brand.website],
];

function patchDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            patchDir(full);
        } else if (entry.name.endsWith('.mdx')) {
            let src = fs.readFileSync(full, 'utf8');
            let out = src;
            for (const [from, to] of urlMap) {
                out = out.split(from).join(to);
            }
            if (out !== src) {
                fs.writeFileSync(full, out);
                console.log('[brand] patched', path.relative(__dirname, full));
            }
        }
    }
}

patchDir(__dirname);

// ── 3. Regenerate logo SVGs ─────────────────────────────────────────────────
const ICON_PATH = 'M55.522 55.676c2.225-2.247 2.225-5.91 0-8.157L16.742 8.343a5.677 5.677 0 0 0-8.073 0c-2.225 2.248-2.225 5.89 0 8.157l38.779 39.176a5.677 5.677 0 0 0 8.074 0M54.486 26.75c2.225-2.248 2.225-5.91 0-8.157L38.76 2.686a5.677 5.677 0 0 0-8.074 0c-2.225 2.247-2.225 5.909 0 8.156L46.43 26.75a5.677 5.677 0 0 0 8.075 0zM33.524 61.314c2.225-2.247 2.225-5.909 0-8.157L17.778 37.252a5.677 5.677 0 0 0-8.074 0c-2.225 2.247-2.225 5.909 0 8.157L25.45 61.314a5.677 5.677 0 0 0 8.074 0';

const makeSvg = (iconColor, textColor) =>
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 148 40">
  <g transform="translate(4, 4) scale(0.5)">
    <path fill="${iconColor}" d="${ICON_PATH}"/>
  </g>
  <text x="44" y="29" font-family="DM Sans, Inter, -apple-system, BlinkMacSystemFont, sans-serif" font-size="32" font-weight="700" letter-spacing="-0.3" fill="${textColor}">${brand.name}</text>
</svg>
`;

const logoDir = path.join(__dirname, 'logo');
fs.writeFileSync(path.join(logoDir, 'light.svg'), makeSvg(brand.primaryColor, '#171B28'));
fs.writeFileSync(path.join(logoDir, 'dark.svg'),  makeSvg('#FFFFFF',           '#FFFFFF'));
console.log('[brand] logos regenerated');

console.log('[brand] done —', brand.name, '/', brand.baseUrl);
