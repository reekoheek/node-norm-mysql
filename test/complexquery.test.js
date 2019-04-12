const assert = require('assert');
const mysql2 = require('mysql2/promise');
const { Manager } = require('node-norm');

const config = {
  adapter: require('../'),
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'testing',
};

async function query (sql, params) {
  let { host, user, password, database } = config;
  let conn = await mysql2.createConnection({ host, user, password, database });
  let [ results, fields ] = await conn.query(sql, params);
  await conn.end();
  return { results, fields };
}

describe.only('complex case', () => {
  beforeEach(async () => {
    await query('DROP TABLE IF EXISTS test');
    await query(`
      CREATE TABLE test (
        id INT AUTO_INCREMENT,
        foo VARCHAR(100),
        bar VARCHAR(100),
        foo2 VARCHAR(100),
        bar2 VARCHAR(100),
        PRIMARY KEY (id)
      )
    `);
    await query('INSERT INTO test (foo,bar,foo2,bar2) VALUES (?,?,?,?)', ['pre1', 'pre2', 'pre2', 'pre4']);
    await query('INSERT INTO test (foo,bar,foo2,bar2) VALUES (?,?,?,?)', ['pre3', 'pre4', 'pre2', 'pre4']);
    await query('INSERT INTO test (foo,bar,foo2,bar2) VALUES (?,?,?,?)', ['pre5', 'pre6', 'pre2', 'pre4']);
  });

  afterEach(async () => {
    await query('DROP TABLE test');
  });

  it('!or only', async () => {
    let manager = new Manager({ connections: [ config ] });

    try {
      await manager.runSession(async session => {
        let data = await session.factory('test', { '!or': [{ 'foo': 'pre1' }, { 'bar': 'pre4' }, { 'bar': 'pre6' }] }).all();

        assert.strictEqual(data.length, 3);
      });
    } finally {
      await manager.end();
    }
  });

  it('complex query or and', async () => {
    let manager = new Manager({ connections: [ config ] });

    try {
      await manager.runSession(async session => {
        let data = await session.factory('test', { '!or': [{ 'foo': 'pre1', 'bar2': 'pre4' }, { 'bar': 'pre4', 'foo2': 'pre2' }] }).all();

        assert.strictEqual(data.length, 2);
      });
    } finally {
      await manager.end();
    }
  });

  it('complex query or with normal query and', async () => {
    let manager = new Manager({ connections: [ config ] });

    try {
      await manager.runSession(async session => {
        let data = await session.factory('test', { 'foo': 'pre1', '!or': [{ 'foo': 'pre1', 'bar2': 'pre4' }, { 'bar': 'pre4', 'foo2': 'pre2' }] }).all();

        assert.strictEqual(data.length, 1);
      });
    } finally {
      await manager.end();
    }
  });
});
