import { PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const permissions = [
  { name: 'users.manage', resource: 'users', action: 'manage', description: 'Manage users' },
  { name: 'users.view', resource: 'users', action: 'view', description: 'View users' },
  { name: 'customers.manage', resource: 'customers', action: 'manage', description: 'Manage customers' },
  { name: 'customers.view', resource: 'customers', action: 'view', description: 'View customers' },
  { name: 'packages.manage', resource: 'packages', action: 'manage', description: 'Manage packages' },
  { name: 'packages.view', resource: 'packages', action: 'view', description: 'View packages' },
  { name: 'bookings.manage', resource: 'bookings', action: 'manage', description: 'Manage bookings' },
  { name: 'bookings.view', resource: 'bookings', action: 'view', description: 'View bookings' },
  { name: 'invoices.manage', resource: 'invoices', action: 'manage', description: 'Manage invoices' },
  { name: 'invoices.view', resource: 'invoices', action: 'view', description: 'View invoices' },
  { name: 'payments.manage', resource: 'payments', action: 'manage', description: 'Manage payments' },
  { name: 'expenses.manage', resource: 'expenses', action: 'manage', description: 'Manage expenses' },
  { name: 'ledger.manage', resource: 'ledger', action: 'manage', description: 'Manage ledger' },
  { name: 'reports.view', resource: 'reports', action: 'view', description: 'View reports' },
  { name: 'settings.manage', resource: 'settings', action: 'manage', description: 'Manage settings' },
  { name: 'audit.view', resource: 'audit', action: 'view', description: 'View audit logs' },
];

async function main() {
  console.log('Seeding database...');

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  const allPermissions = await prisma.permission.findMany();

  const roles: { name: RoleName; description: string; permissionNames: string[] }[] = [
    {
      name: 'SUPER_ADMIN',
      description: 'Complete system control',
      permissionNames: permissions.map((p) => p.name),
    },
    {
      name: 'ADMIN',
      description: 'Manage customers, packages, bookings, invoices, payments, expenses, and reports',
      permissionNames: permissions.filter((p) => p.name !== 'settings.manage').map((p) => p.name),
    },
    {
      name: 'USER',
      description: 'Add customers, create bookings, record payments',
      permissionNames: [
        'customers.manage',
        'customers.view',
        'packages.view',
        'bookings.manage',
        'bookings.view',
        'invoices.view',
        'payments.manage',
      ],
    },
  ];

  for (const roleData of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleData.name },
      update: { description: roleData.description },
      create: { name: roleData.name, description: roleData.description },
    });

    for (const permName of roleData.permissionNames) {
      const perm = allPermissions.find((p) => p.name === permName);
      if (perm) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          update: {},
          create: { roleId: role.id, permissionId: perm.id },
        });
      }
    }
  }

  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const userRole = await prisma.role.findUnique({ where: { name: 'USER' } });

  const hashedPassword = await bcrypt.hash('admin123', 12);
  const superAdminPassword = await bcrypt.hash(
    process.env.SEED_SUPER_ADMIN_PASSWORD || 'Pakistan@123',
    12,
  );

  await prisma.user.upsert({
    where: { email: 'tahasheikh682@gmail.com' },
    update: {
      password: superAdminPassword,
      firstName: 'Taha',
      lastName: 'Sheikh',
      roleId: superAdminRole!.id,
      isActive: true,
      inviteToken: null,
      inviteExpiresAt: null,
      passwordSetAt: new Date(),
    },
    create: {
      email: 'tahasheikh682@gmail.com',
      password: superAdminPassword,
      firstName: 'Taha',
      lastName: 'Sheikh',
      phone: '',
      roleId: superAdminRole!.id,
      passwordSetAt: new Date(),
    },
  });

  await prisma.user.upsert({
    where: { email: 'superadmin@travel.com' },
    update: {},
    create: {
      email: 'superadmin@travel.com',
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      phone: '+1234567890',
      roleId: superAdminRole!.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@travel.com' },
    update: {},
    create: {
      email: 'admin@travel.com',
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Admin',
      phone: '+1234567891',
      roleId: adminRole!.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'employee@travel.com' },
    update: {},
    create: {
      email: 'employee@travel.com',
      password: hashedPassword,
      firstName: 'John',
      lastName: 'Employee',
      phone: '+1234567892',
      roleId: userRole!.id,
    },
  });

  const accounts = [
    { name: 'Cash Account', code: 'CASH-001', type: 'CASH' as const },
    { name: 'Bank Account', code: 'BANK-001', type: 'BANK' as const },
    { name: 'Income Account', code: 'INCOME-001', type: 'CASH' as const },
  ];

  for (const acc of accounts) {
    await prisma.account.upsert({
      where: { code: acc.code },
      update: {},
      create: acc,
    });
  }

  const settings = [
    { key: 'company_name', value: 'Huffaz Holiday', category: 'general' },
    { key: 'company_email', value: 'info@moazintravel.com', category: 'general' },
    { key: 'company_phone', value: '+1234567890', category: 'general' },
    { key: 'company_address', value: '123 Travel Street, City', category: 'general' },
    { key: 'currency', value: 'PKR', category: 'financial' },
    { key: 'currency_locale', value: 'en-PK', category: 'financial' },
    { key: 'default_pkr_sar_rate', value: '75', category: 'financial' },
    { key: 'tax_rate', value: '0', category: 'financial' },
    { key: 'invoice_prefix', value: 'INV', category: 'financial' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  const samplePackages = [
    {
      name: 'Dubai Luxury Escape',
      description: '5-day luxury trip to Dubai with hotel and city tour',
      price: 2500,
      duration: 5,
      destinations: [{ destination: 'Dubai', country: 'UAE', nights: 5 }],
    },
    {
      name: 'Istanbul Cultural Tour',
      description: '7-day cultural exploration of Istanbul',
      price: 1800,
      duration: 7,
      destinations: [
        { destination: 'Istanbul', country: 'Turkey', nights: 4 },
        { destination: 'Cappadocia', country: 'Turkey', nights: 3 },
      ],
    },
    {
      name: 'Umrah Package',
      description: '10-day Umrah pilgrimage package',
      price: 3200,
      duration: 10,
      destinations: [
        { destination: 'Makkah', country: 'Saudi Arabia', nights: 5 },
        { destination: 'Madinah', country: 'Saudi Arabia', nights: 5 },
      ],
    },
  ];

  for (const pkg of samplePackages) {
    const existing = await prisma.package.findFirst({ where: { name: pkg.name } });
    if (!existing) {
      await prisma.package.create({
        data: {
          name: pkg.name,
          description: pkg.description,
          price: pkg.price,
          duration: pkg.duration,
          destinations: { create: pkg.destinations },
        },
      });
    }
  }

  const defaultVendors = [
    { name: 'Grand Hotel Partners', category: 'HOTEL' as const },
    { name: 'Global Visa Services', category: 'VISA' as const },
    { name: 'Skyline Ticketing', category: 'TICKETING' as const },
  ];

  for (const v of defaultVendors) {
    const existing = await prisma.vendor.findFirst({ where: { name: v.name } });
    if (!existing) {
      const vendor = await prisma.vendor.create({ data: v });
      await prisma.account.create({
        data: {
          name: `Vendor: ${vendor.name}`,
          code: `VND-${v.category}`,
          type: 'SUPPLIER',
          vendorId: vendor.id,
        },
      });
    }
  }

  const existingTemplate = await prisma.invoiceTemplate.findFirst({ where: { isDefault: true } });
  if (!existingTemplate) {
    await prisma.invoiceTemplate.create({
      data: {
        name: 'Default Invoice',
        isDefault: true,
        header: 'Huffaz Holiday\nProfessional Travel Services',
        footer: 'Thank you for choosing Huffaz Holiday!',
        terms: 'Payment is due by the due date shown above.',
      },
    });
  }

  await prisma.account.upsert({
    where: { code: 'COS-001' },
    update: {},
    create: { name: 'Cost of Sales', code: 'COS-001', type: 'SUPPLIER' },
  });

  await prisma.documentSequence.upsert({
    where: { id: 'booking' },
    update: {},
    create: { id: 'booking', nextValue: 1 },
  });

  const { syncDocumentSequenceFromDatabase } = await import('../src/services/numberingService');
  await syncDocumentSequenceFromDatabase();

  console.log('Seed completed successfully!');
  console.log('\nDefault login credentials (password: admin123):');
  console.log('  Super Admin: superadmin@travel.com');
  console.log('  Admin:       admin@travel.com');
  console.log('  Employee:    employee@travel.com');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
