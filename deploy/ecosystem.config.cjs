const path = require('path');

/** Copy to /var/www/travel-agency-backend/ecosystem.config.cjs on the VPS */
module.exports = {
  apps: [
    {
      name: 'travel-agency-api',
      script: 'dist/index.js',
      cwd: path.join(__dirname),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      output: path.join(__dirname, 'logs', 'pm2-out.log'),
      error: path.join(__dirname, 'logs', 'pm2-error.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: 5011,
      },
    },
  ],
};
