require('dotenv').config()

module.exports = {
  apps: [
    {
      name: 'portview',
      script: 'app.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '8000',
        BASE_PATH: process.env.BASE_PATH || '/portview',
        BASE_URL: process.env.BASE_URL || '',
      },
    },
  ],
}
