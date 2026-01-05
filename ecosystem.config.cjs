module.exports = {
  apps: [
    {
      name: 'portview',
      script: 'app.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        BASE_PATH: '/portview',
      },
    },
  ],
}
