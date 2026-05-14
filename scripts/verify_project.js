const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const requiredFiles = [
  'server.js',
  'package.json',
  'database_setup.sql',
  'public/main.html',
  'public/admin.html',
  'public/api-integration.js',
  'public/icons/android-chrome-192x192.png',
  'public/icons/no-image.png'
];

let ok = true;
function check(condition, message) {
  if (condition) {
    console.log('✓ ' + message);
  } else {
    ok = false;
    console.error('✗ ' + message);
  }
}

for (const file of requiredFiles) {
  check(fs.existsSync(path.join(root, file)), `Файл найден: ${file}`);
}

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
[
  "app.get('/api/info'",
  "app.get('/api/health'",
  "app.get('/api/products'",
  "app.post('/api/admin/login'",
  "app.post('/api/products'",
  "app.put('/api/products/:id'",
  "app.delete('/api/products/:id'",
  "app.get('/api/stats/summary'"
].forEach(route => check(server.includes(route), `Маршрут есть: ${route}`));

const sql = fs.readFileSync(path.join(root, 'database_setup.sql'), 'utf8');
[
  'CREATE TABLE USERS',
  'CREATE TABLE PRODUCTS',
  'CREATE TABLE ORDERS',
  'CREATE TABLE ORDER_ITEMS',
  'CREATE TABLE SUPPLIERS',
  'INSERT INTO USERS',
  'INSERT INTO PRODUCTS'
].forEach(fragment => check(sql.includes(fragment), `SQL содержит: ${fragment}`));

const admin = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
[
  'authHeaders',
  'saveProduct',
  'saveCustomer',
  'saveOrder',
  'saveSupplier',
  'deleteSupplier',
  'downloadStatsChart'
].forEach(fragment => check(admin.includes(fragment), `Админ-панель содержит: ${fragment}`));

if (!ok) {
  console.error('\nПроверка завершилась с ошибками. Исправьте отмеченные пункты.');
  process.exit(1);
}

console.log('\nПроект прошёл базовую проверку структуры.');
