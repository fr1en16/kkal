const express = require('express');
const path = require('path');
const app = require('./_app');

app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/favicon.webp');
});

app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
