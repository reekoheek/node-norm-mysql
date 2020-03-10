const mysql2 = require('mysql2/promise');

module.exports = config => {
  return async function query (sql, params) {
    const { host, user, password, database } = config;
    const conn = await mysql2.createConnection({ host, user, password, database });
    const [results, fields] = await conn.query(sql, params);
    await conn.end();
    return { results, fields };
  };
};
