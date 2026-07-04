import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import authRoutes from './routes/authRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import customerRoutes from './routes/customerRoutes';
import packageRoutes from './routes/packageRoutes';
import bookingRoutes from './routes/bookingRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import paymentRoutes from './routes/paymentRoutes';
import expenseRoutes from './routes/expenseRoutes';
import ledgerRoutes from './routes/ledgerRoutes';
import reportRoutes from './routes/reportRoutes';
import userRoutes from './routes/userRoutes';
import notificationRoutes from './routes/notificationRoutes';
import activityLogRoutes from './routes/activityLogRoutes';
import settingsRoutes from './routes/settingsRoutes';
import publicRoutes from './routes/publicRoutes';
import vendorRoutes from './routes/vendorRoutes';
import voucherRoutes from './routes/voucherRoutes';
import checkInRoutes from './routes/checkInRoutes';
import vendorPostingRoutes from './routes/vendorPostingRoutes';
import approvalRoutes from './routes/approvalRoutes';
import postingRequestRoutes from './routes/postingRequestRoutes';
import uploadRoutes from './routes/uploadRoutes';
import currencyRoutes from './routes/currencyRoutes';
import { startScheduler } from './services/schedulerService';

const uploadDir = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();

const devOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const configured = process.env.FRONTEND_URL;
      const allowed = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        configured,
      ].filter(Boolean) as string[];

      if (
        allowed.includes(origin) ||
        (process.env.NODE_ENV !== 'production' && devOriginPattern.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

const assetsDir = path.resolve(__dirname, '../assets');
if (fs.existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir));
}

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Travel Agency API is running', version: '1.0.0' });
});

app.use('/api/public', publicRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/check-ins', checkInRoutes);
app.use('/api/vendor-postings', vendorPostingRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/posting-requests', postingRequestRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/currency', currencyRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

startScheduler();

app.listen(config.port, () => {
  console.log(`Travel Agency API running on port ${config.port}`);
});

export default app;
