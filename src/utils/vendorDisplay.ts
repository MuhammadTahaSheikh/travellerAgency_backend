type VendorLike = { name?: string | null; vendorCode?: string | null } | null | undefined;

/** e.g. ADEN (HHV-0001) */
export function formatVendorDisplay(vendor: VendorLike, fallback = ''): string {
  if (!vendor?.name) return fallback;
  return vendor.vendorCode ? `${vendor.name} (${vendor.vendorCode})` : vendor.name;
}
