module.exports = function config (config) {
  return {
    adapter: require('../..'),
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'testing',
    ...config,
  };
};
