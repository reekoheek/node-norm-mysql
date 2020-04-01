const mysql2 = require('mysql2/promise');

module.exports = (config) => {
  const { host, user, password, database } = require('./config')(config);

  return async function query (sql, params) {
    const conn = await mysql2.createConnection({ host, user, password, database });
    try {
      const [results, fields] = await conn.query(sql, params);
      return { results, fields };
    } finally {
      await conn.end();
    }
  };
};
