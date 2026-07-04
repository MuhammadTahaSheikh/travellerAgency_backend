type CustomerLike = {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  customerType?: string | null;
};

export function formatCustomerName(customer: CustomerLike): string {
  if (customer.customerType === 'B2B' && customer.companyName?.trim()) {
    return customer.companyName.trim();
  }
  return [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter((part) => part && part !== '-')
    .join(' ');
}

/** e.g. AFZAL (BK-001) */
export function formatCustomerLedgerLabel(
  customer: CustomerLike,
  bookingNumber?: string | null,
): string {
  const base = formatCustomerName(customer) || 'Customer';
  return bookingNumber ? `${base} (${bookingNumber})` : base;
}
