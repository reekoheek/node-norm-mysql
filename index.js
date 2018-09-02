const Connection = require('node-norm/connection');
const mysql = require('mysql');
const debug = require('debug')('node-norm-mysql:index');

const OPERATORS = {
  'eq': '=',
  'gt': '>',
  'lt': '<',
  'gte': '>=',
  'lte': '<=',
  'like': 'like',
};

class Mysql extends Connection {
  constructor (options) {
    super(options);

    let { host, user, password, database } = options;
    this.host = host;
    this.user = user;
    this.password = password;
    this.database = database;

    this.createConnection();
  }

  createConnection () {
    this.conn = mysql.createConnection(this);
    this.conn.on('error', this._dberror.bind(this));
  }

  _dberror (err) {
    debug('Database error', err);

    // Connection to the MySQL server is usually
    // lost due to either server restart
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      this.createConnection();
      return;
    }

    throw err;
  }

  _mysqlQuery (sql, params) {
    return new Promise((resolve, reject) => {
      this.conn.query(sql, params, (err, result, fields) => {
        if (err) {
          return reject(err);
        }

        resolve({ result, fields });
      });
    });
  }

  async insert (query, callback = () => {}) {
    let fieldNames = query.schema.fields.map(field => field.name);
    if (!fieldNames.length) {
      fieldNames = query._inserts.reduce((fieldNames, row) => {
        for (let f in row) {
          if (fieldNames.indexOf(f) === -1) {
            fieldNames.push(f);
          }
        }
        return fieldNames;
      }, []);
    }

    let placeholder = fieldNames.map(f => '?');
    let sql = `INSERT INTO ${query.schema.name} (${fieldNames.join(',')}) VALUES (${placeholder})`;

    let changes = 0;
    await Promise.all(query._inserts.map(async row => {
      let rowData = fieldNames.map(f => row[f]);

      let { result } = await this._mysqlQuery(sql, rowData);
      row.id = result.insertId;
      changes += result.affectedRows;

      callback(row);
    }));

    return changes;
  }

  async load (query, callback = () => {}) {
    let sqlArr = [ `SELECT * FROM ${mysql.escapeId(query.schema.name)}` ];
    let [ wheres, data ] = this.getWhere(query);
    if (wheres) {
      sqlArr.push(wheres);
    }

    let orderBys = this.getOrderBy(query);
    if (orderBys) {
      sqlArr.push(orderBys);
    }

    if (query._limit >= 0) {
      sqlArr.push(`LIMIT ${query._limit}`);

      if (query._skip > 0) {
        sqlArr.push(`OFFSET ${query._skip}`);
      }
    }

    let sql = sqlArr.join(' ');

    let { result } = await this._mysqlQuery(sql, data);
    return result.map(row => {
      callback(row);
      return row;
    });
  }

  async delete (query, callback) {
    let [ wheres, data ] = this.getWhere(query);
    let sqlArr = [`DELETE FROM ${query.schema.name}`];
    if (wheres) {
      sqlArr.push(wheres);
    }

    let sql = sqlArr.join(' ');

    await this._mysqlQuery(sql, data);
  }

  getOrderBy (query) {
    let orderBys = [];
    for (let key in query._sorts) {
      let val = query._sorts[key];

      orderBys.push(`${mysql.escapeId(key)} ${val || 'DESC'}`);
    }

    if (!orderBys.length) {
      return;
    }

    return `ORDER BY ${orderBys.join(', ')}`;
  }

  async update (query) {
    let keys = Object.keys(query._sets);

    let params = keys.map(k => query._sets[k]);
    let placeholder = keys.map(k => `${mysql.escapeId(k)} = ?`);

    let [ wheres, data ] = this.getWhere(query);
    let sql = `UPDATE ${mysql.escapeId(query.schema.name)} SET ${placeholder.join(', ')} ${wheres}`;
    let { result } = await this._mysqlQuery(sql, params.concat(data));

    return result.affectedRows;
  }

  getWhere (query) {
    let wheres = [];
    let data = [];
    for (let key in query._criteria) {
      let value = query._criteria[key];
      let [ field, operator = 'eq' ] = key.split('!');

      // add by januar: for chek if operator like value change to %
      if (operator === 'like') {
        value = `%${value}%`;
      }

      data.push(value);
      wheres.push(`${mysql.escapeId(field)} ${OPERATORS[operator]} ?`);
    }

    if (!wheres.length) {
      return [];
    }

    return [ `WHERE ${wheres.join(' AND ')}`, data ];
  }

  begin () {
    return new Promise((resolve, reject) => {
      this.conn.beginTransaction(err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  commit () {
    return new Promise((resolve, reject) => {
      this.conn.commit(err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  rollback () {
    return new Promise((resolve, reject) => {
      this.conn.rollback(err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }
}

module.exports = Mysql;
