// Ported from open-screenshot-generator (MIT), src/lib/i18n/hash.ts
// A fingerprint of the base string a translation was made from.
//
// Stored on every override as `sourceHash`. When the English headline is later
// edited the hash stops matching and the translation is flagged stale instead
// of being silently overwritten, which is the one behaviour every reference
// tool converged on: refreshing a reviewed human translation is always an
// explicit action.
//
// FNV-1a, 32 bits. Not a security hash and not trying to be: it is compared
// against a value we wrote ourselves seconds earlier, so collision resistance
// costs more than it buys, and this runs over every localizable string on every
// render of the translation table.
export { hash32 } from '@chitrapx/document';
