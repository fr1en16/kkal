const express = require('express');
const path = require('path');
const app = require('./_app');

app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
