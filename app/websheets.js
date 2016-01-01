"use strict";
var _ = require("underscore");
var fs = require("fs");

var cjson = require("./cjson");
var i = require("./input");
var o = require("./output");

class WebSheet {
  constructor() {
    this.users = {admin: {user: "admin", pass: "pass"}};
    this.input = {};
    this.output = {values:{}, permissions:{}};
    this.createTable("admin", "prova", "here", ["a", "bb", "ab"]);
    this.input.prova.addRow("admin");
  }

  save(path) {
    var json = cjson.stringify(this);
    fs.writeFileSync(path, json, "utf8");
  }
  static load(path) {
    var json = fs.readFileSync(path, "utf8");
    return cjson.parse(json);
  }

  authUser(user, pass) {
    return this.users[user] && this.users[user].pass === pass;
  }
  createUser(user, pass) {
    if (this.users[user])
      return false;
    this.users[user] = {user, pass};
    return true;
  }
  deleteUser(user) {
    if (user === "admin" || !this.users[user])
      return false;
    delete this.users[user];
    return true;
  }
  listUsers() {
    // [{user, [tablenames]}]
    return _(this.users).map(u => {
      return {user: u.user, tables: _.chain(this.input).where({owner: u.user}).pluck("name").value()};
    });
  }
  purge() {
    this.output = {values:{}, permissions: {}};
  }

  listTables() {
    // [publicTable]
    return _.map(this.input, t => _.pick(t, "name", "description", "owner"));
  }
  listKeywords() {
    // {tables, columns, functions}
    return {
      tables: _(this.input).keys(),
      columns: _.chain(this.input).pluck("columns").flatten().value(),
      functions: [] // TODO
    };
  }
  createTable(user, name, desc, columns) {
    this.input[name] = new i.Table(name, desc, user, columns);
    return true;
  }
  getInputTable(name) {
    // server performed access control
    return cjson.stringify(this.input[name].export());
  }
  addRow(user, name, row) {
    // TODO: evaluate add row permission
    this.input[name].addRow(user, row);
  }
  deleteRow(user, name, row) {
    // TODO: evaluate del row permission
    this.input[name].deleteRow(row);
  }
  writeCell(user, name, row, column, src) {
    // TODO: evaluate write permission (add newVal and oldVal to env)
    // TODO: update ownership if cells will have owners
    this.input[name].writeCell(row, column, src);
  }
}
cjson.register(WebSheet);
exports.WebSheet = WebSheet;