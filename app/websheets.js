"use strict";
var _ = require("underscore");
var fs = require("fs");

module.exports = {
  create: () => new WebSheet(),
  load: function(path) {
    var json = JSON.parse(fs.readFileSync(path, "utf8"));
    return new WebSheet({}, json.users); // TODO: tables
  }
};

function WebSheet(tables, users) {
  if (!tables)
    tables = {};
  if (!users)
    users = {admin: {user: "admin", pass: "pass"}};
  this.tables = tables;
  this.cache = {};
  this.users = users;
}

WebSheet.prototype = {
  save: function(path) {
    var json = JSON.stringify({users: this.users}); // TODO: tables
    fs.writeFileSync(path, json, "utf8");
  },

  authUser: function(user, pass) {
    return this.users[user] && this.users[user].pass === pass;
  },
  createUser: function(user, pass) {
    if (this.users[user])
      return false;
    this.users[user] = {user, pass};
    return true;
  },
  deleteUser: function(user) {
    if (user === "admin" || !this.users[user])
      return false;
    delete this.users[user];
    return true;
  },
  listUsers: function() {
    return Object.keys(this.users);
  },

  listTables: function() {
    return _.map(this.tables, t => _.pick(t, "name", "description", "owner"));
  },
  // import
};