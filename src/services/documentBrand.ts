export const BRAND_NAME = 'Huffaz Holiday';
export const BRAND_TAGLINE = 'Professional Travel Services';
export const LOGO_ASSET_PATH = '/assets/huffaz-holiday-logo.png';

export type DocumentIssuer = {
  name: string;
  address: string;
  phone: string;
  email: string;
  contact: string;
  tradePartnerId: string;
  isB2B: boolean;
};

export function publicBaseUrl(baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  return (
    process.env.API_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5001'
  ).replace(/\/$/, '');
}

export function logoUrl(baseUrl?: string): string {
  return `${publicBaseUrl(baseUrl)}${LOGO_ASSET_PATH}`;
}

export function logoHtml(baseUrl?: string, alt = BRAND_NAME): string {
  return `<img src="${logoUrl(baseUrl)}" alt="${alt}" style="max-height:72px;max-width:220px;object-fit:contain" />`;
}

export function issuerFromCustomer(customer: {
  customerType: string;
  companyName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  tradePartnerId?: string | null;
  firstName?: string;
  lastName?: string;
}): DocumentIssuer {
  if (customer.customerType === 'B2B' && customer.companyName) {
    return {
      name: customer.companyName,
      address: customer.address || '',
      phone: customer.phone || '',
      email: customer.email || '',
      contact: customer.contactPerson || '',
      tradePartnerId: customer.tradePartnerId || '',
      isB2B: true,
    };
  }
  return {
    name: BRAND_NAME,
    address: BRAND_TAGLINE,
    phone: '',
    email: '',
    contact: '',
    tradePartnerId: '',
    isB2B: false,
  };
}

export function documentHeaderHtml(issuer: DocumentIssuer, baseUrl?: string, title?: string): string {
  const logo = issuer.isB2B ? '' : `<div style="margin-bottom:12px">${logoHtml(baseUrl)}</div>`;
  const tradePartner = issuer.tradePartnerId
    ? `<p style="margin:4px 0 0;font-size:13px;color:#64748b">Trade Partner: <strong>${issuer.tradePartnerId}</strong></p>`
    : '';
  return `
<div style="border-bottom:2px solid #0d9488;padding-bottom:16px;margin-bottom:24px">
  ${logo}
  ${title ? `<h1 style="color:#0d9488;margin:0 0 8px;font-size:22px">${title}</h1>` : ''}
  <div style="font-size:15px;line-height:1.5">
    <strong>${issuer.name}</strong><br>
    ${issuer.address ? `${issuer.address}<br>` : ''}
    ${issuer.phone}${issuer.email ? ` | ${issuer.email}` : ''}
    ${issuer.contact ? `<br>Contact: ${issuer.contact}` : ''}
    ${tradePartner}
  </div>
</div>`;
}

export const DOCUMENT_STYLES = `
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; font-size: 13px; }
  th { background: #f1f5f9; text-align: left; }
  .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 16px 0; }
  .summary-box { padding: 12px; background: #f8fafc; border-radius: 8px; }
  .summary-label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: bold; }
  .summary-value { font-size: 18px; font-weight: bold; margin-top: 4px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
`;
