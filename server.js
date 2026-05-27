require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'medicalequipmentstore_jwt_secret';
const SESSION_SECRET = process.env.SESSION_SECRET || 'medicalequipmentstore_secret';

const uploadsDir = path.join(__dirname, 'uploads');
const dbDir = path.join(__dirname, 'data');
const dbPath = path.join(dbDir, 'medicalequipment.sqlite');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const transporter = nodemailer.createTransport({
    host: 'smtp.mail.ru',
    port: 465,
    secure: true,
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});

app.use('/uploads', express.static(uploadsDir));
app.use('/public', express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();

        if (!allowed.includes(ext)) {
            return cb(new Error('Разрешены только изображения JPG, JPEG, PNG и WEBP'));
        }

        cb(null, true);
    }
});

const db = new sqlite3.Database(dbPath);

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, function (err, row) {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, function (err, rows) {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function sha1(text) {
    return crypto.createHash('sha1').update(text).digest('hex').toUpperCase();
}

function adminAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Требуется авторизация администратора'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Недостаточно прав доступа'
            });
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Недействительный токен'
        });
    }
}

app.use(cors({ origin: true, credentials: true }));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

async function initDatabase() {
    await dbRun(`PRAGMA foreign_keys = ON`);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS USERS (
            USER_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            FULL_NAME TEXT NOT NULL,
            PHONE TEXT NOT NULL,
            EMAIL TEXT NOT NULL UNIQUE,
            LOGIN TEXT NOT NULL UNIQUE,
            PASSWORD TEXT NOT NULL
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS CUSTOMERS (
            CUSTOMER_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            USER_ID INTEGER NOT NULL UNIQUE,
            DELIVERY_ADDRESS TEXT NOT NULL,
            FOREIGN KEY (USER_ID) REFERENCES USERS(USER_ID) ON DELETE CASCADE
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS PRODUCT_CATEGORIES (
            CATEGORY_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            NAME TEXT NOT NULL UNIQUE
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS PRODUCTS (
            PRODUCT_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            CATEGORY_ID INTEGER NOT NULL,
            NAME TEXT NOT NULL,
            CURRENT_SALE_PRICE REAL NOT NULL,
            CURRENT_PURCHASE_PRICE REAL NOT NULL DEFAULT 0,
            DESCRIPTION TEXT,
            IMAGE TEXT,
            MANUFACTURER TEXT,
            EXECUTION_TYPE TEXT,
            SYSTEM_CLASS TEXT,
            MONITOR_SIZE TEXT,
            ACTIVE_PORTS TEXT,
            WEIGHT TEXT,
            FOREIGN KEY (CATEGORY_ID) REFERENCES PRODUCT_CATEGORIES(CATEGORY_ID)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS ORDER_STATUSES (
            ORDER_STATUS_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            NAME TEXT NOT NULL UNIQUE
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS ORDERS (
            ORDER_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            CUSTOMER_ID INTEGER NOT NULL,
            ORDER_DATE TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ORDER_STATUS_ID INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (CUSTOMER_ID) REFERENCES CUSTOMERS(CUSTOMER_ID),
            FOREIGN KEY (ORDER_STATUS_ID) REFERENCES ORDER_STATUSES(ORDER_STATUS_ID)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS ORDER_ITEMS (
            ORDER_ID INTEGER NOT NULL,
            PRODUCT_ID INTEGER NOT NULL,
            SALE_PRICE_AT_TIME REAL NOT NULL,
            QUANTITY INTEGER NOT NULL,
            PRIMARY KEY (ORDER_ID, PRODUCT_ID),
            FOREIGN KEY (ORDER_ID) REFERENCES ORDERS(ORDER_ID) ON DELETE CASCADE,
            FOREIGN KEY (PRODUCT_ID) REFERENCES PRODUCTS(PRODUCT_ID)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS SUPPLIERS (
            SUPPLIER_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            NAME TEXT NOT NULL,
            LEGAL_ADDRESS TEXT NOT NULL
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS SUPPLIES (
            SUPPLY_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            SUPPLIER_ID INTEGER NOT NULL,
            SUPPLY_DATE TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (SUPPLIER_ID) REFERENCES SUPPLIERS(SUPPLIER_ID) ON DELETE CASCADE
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS SUPPLY_ITEMS (
            SUPPLY_ID INTEGER NOT NULL,
            PRODUCT_ID INTEGER NOT NULL,
            QUANTITY INTEGER NOT NULL,
            PURCHASE_PRICE_AT_TIME REAL NOT NULL,
            PRIMARY KEY (SUPPLY_ID, PRODUCT_ID),
            FOREIGN KEY (SUPPLY_ID) REFERENCES SUPPLIES(SUPPLY_ID) ON DELETE CASCADE,
            FOREIGN KEY (PRODUCT_ID) REFERENCES PRODUCTS(PRODUCT_ID)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS PAYMENTS (
            PAYMENT_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            ORDER_ID INTEGER NOT NULL,
            PAYMENT_METHOD TEXT,
            PAYMENT_STATUS TEXT,
            FOREIGN KEY (ORDER_ID) REFERENCES ORDERS(ORDER_ID) ON DELETE CASCADE
        )
    `);

    await seedDatabase();
}

async function seedDatabase() {
    const admin = await dbGet(`SELECT USER_ID FROM USERS WHERE LOGIN = ?`, ['admin']);

    if (!admin) {
        await dbRun(
            `INSERT INTO USERS (FULL_NAME, PHONE, EMAIL, LOGIN, PASSWORD) VALUES (?, ?, ?, ?, ?)`,
            ['Администратор системы', '+79990000001', 'admin@mail.ru', 'admin', sha1('admin')]
        );
    }

    const categoriesCount = await dbGet(`SELECT COUNT(*) AS count FROM PRODUCT_CATEGORIES`);

    if (categoriesCount.count === 0) {
        const categories = [
            'Диагностическое оборудование',
            'Лабораторное оборудование',
            'Хирургическое оборудование'
        ];

        for (const name of categories) {
            await dbRun(`INSERT INTO PRODUCT_CATEGORIES (NAME) VALUES (?)`, [name]);
        }
    }

    const statusesCount = await dbGet(`SELECT COUNT(*) AS count FROM ORDER_STATUSES`);

    if (statusesCount.count === 0) {
        const statuses = ['Новый', 'В обработке', 'Оплачен', 'Отправлен', 'Доставлен', 'Отменён'];

        for (const name of statuses) {
            await dbRun(`INSERT INTO ORDER_STATUSES (NAME) VALUES (?)`, [name]);
        }
    }

    const productsCount = await dbGet(`SELECT COUNT(*) AS count FROM PRODUCTS`);

    if (productsCount.count === 0) {
        await dbRun(`
            INSERT INTO PRODUCTS 
            (CATEGORY_ID, NAME, CURRENT_SALE_PRICE, CURRENT_PURCHASE_PRICE, DESCRIPTION, IMAGE, MANUFACTURER, EXECUTION_TYPE, SYSTEM_CLASS, MONITOR_SIZE, ACTIVE_PORTS, WEIGHT)
            VALUES
            (1, 'УЗИ аппарат Samsung HS70A', 3500000, 2900000, 'Современный УЗИ аппарат для диагностических исследований.', '/uploads/ultrasound_devices/uzi-apparat-samsung-hs70.jpg', 'Samsung', 'Портативный', 'Премиум', '17"', 'USB, HDMI, VGA', '234'),
            (1, 'Рентгеновский аппарат Carestream DRX-Revolution', 6200000, 5100000, 'Мобильная цифровая рентгеновская система.', '/uploads/xray_equipment/mobileart-evolution.png', 'Carestream', 'Мобильный', 'Профессиональный', '19"', 'USB, LAN', '380'),
            (2, 'Лабораторный микроскоп', 75000, 55000, 'Микроскоп для лабораторной диагностики.', '/uploads/laboratory_equipment/laboratornyy-mikroskop.jpg', 'Olympus', 'Настольный', 'Базовый', '—', '—', '8'),
            (3, 'Хирургический стол', 180000, 130000, 'Стол для хирургических кабинетов и операционных.', '/uploads/surgical_equipment/hirurgicheskiy-stol.jpg', 'Armed', 'Стационарный', 'Стандарт', '—', '—', '120')
        `);
    }

    const customersCount = await dbGet(`SELECT COUNT(*) AS count FROM CUSTOMERS`);

    if (customersCount.count === 0) {
        await dbRun(
            `INSERT INTO USERS (FULL_NAME, PHONE, EMAIL, LOGIN, PASSWORD) VALUES (?, ?, ?, ?, ?)`,
            ['Петров Петр Олегович', '+79990000002', 'client1@mail.ru', 'client1', sha1('client1')]
        );

        const user1 = await dbGet(`SELECT USER_ID FROM USERS WHERE LOGIN = ?`, ['client1']);

        await dbRun(
            `INSERT INTO CUSTOMERS (USER_ID, DELIVERY_ADDRESS) VALUES (?, ?)`,
            [user1.USER_ID, 'г. Москва, ул. Ленина, д. 10']
        );

        await dbRun(
            `INSERT INTO USERS (FULL_NAME, PHONE, EMAIL, LOGIN, PASSWORD) VALUES (?, ?, ?, ?, ?)`,
            ['Смирнова Анна Олеговна', '+79990000003', 'client2@mail.ru', 'client2', sha1('client2')]
        );

        const user2 = await dbGet(`SELECT USER_ID FROM USERS WHERE LOGIN = ?`, ['client2']);

        await dbRun(
            `INSERT INTO CUSTOMERS (USER_ID, DELIVERY_ADDRESS) VALUES (?, ?)`,
            [user2.USER_ID, 'г. Санкт-Петербург, Невский пр., д. 25']
        );
    }

    const suppliersCount = await dbGet(`SELECT COUNT(*) AS count FROM SUPPLIERS`);

    if (suppliersCount.count === 0) {
        await dbRun(`
            INSERT INTO SUPPLIERS (NAME, LEGAL_ADDRESS)
            VALUES
            ('Samsung Medical', 'Республика Корея, Сеул'),
            ('Carestream Health', 'США, Нью-Йорк'),
            ('Armed', 'Россия, Москва')
        `);
    }

    const ordersCount = await dbGet(`SELECT COUNT(*) AS count FROM ORDERS`);

    if (ordersCount.count === 0) {
        const customer = await dbGet(`SELECT CUSTOMER_ID FROM CUSTOMERS ORDER BY CUSTOMER_ID LIMIT 1`);

        if (customer) {
            const order = await dbRun(
                `INSERT INTO ORDERS (CUSTOMER_ID, ORDER_DATE, ORDER_STATUS_ID) VALUES (?, ?, ?)`,
                [customer.CUSTOMER_ID, '2026-05-08T12:00:00.000Z', 2]
            );

            await dbRun(
                `INSERT INTO ORDER_ITEMS (ORDER_ID, PRODUCT_ID, SALE_PRICE_AT_TIME, QUANTITY) VALUES (?, ?, ?, ?)`,
                [order.lastID, 2, 6200000, 1]
            );
        }
    }
}

function sendPublicPage(pageName) {
    return (req, res) => {
        const filePath = path.join(__dirname, 'public', pageName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('Страница не найдена');
        }

        res.sendFile(filePath);
    };
}

app.get('/', sendPublicPage('main.html'));
app.get('/catalog', sendPublicPage('Untitled-6.html'));
app.get('/about', sendPublicPage('about.html'));
app.get('/services', sendPublicPage('Untitled-8.html'));
app.get('/partners', sendPublicPage('Untitled-7.html'));
app.get('/contacts', sendPublicPage('Untitled-5.html'));
app.get('/admin', sendPublicPage('admin.html'));
app.get('/experiment', sendPublicPage('experiment.html'));
app.get('/exp', sendPublicPage('exp.html'));
app.get('/operator_guide', sendPublicPage('operator_guide.html'));

app.get('/api/info', (req, res) => {
    res.json({
        success: true,
        data: {
            name: 'MedicalEquipmentStore API',
            database: 'SQLite',
            version: '1.0.0'
        }
    });
});

app.get('/api/health', async (req, res) => {
    try {
        await dbGet('SELECT 1 AS ok');
        res.json({ success: true, database: 'connected' });
    } catch (error) {
        res.status(500).json({
            success: false,
            database: 'disconnected',
            error: error.message
        });
    }
});

app.get('/api/pages', (req, res) => {
    res.json({
        success: true,
        data: [
            { path: '/', title: 'Главная' },
            { path: '/catalog', title: 'Каталог' },
            { path: '/about', title: 'О компании' },
            { path: '/services', title: 'Услуги' },
            { path: '/partners', title: 'Партнёры' },
            { path: '/contacts', title: 'Контакты' },
            { path: '/operator_guide', title: 'Руководство оператора' }
        ]
    });
});

app.get('/api/about', (req, res) => {
    res.json({
        success: true,
        data: {
            whoWeAre: [
                'VitaEquip — интернет-ресурс для продажи медтехники, предназначенный для просмотра каталога оборудования, оформления заказов и взаимодействия с клиентами.',
                'Интернет-ресурс объединяет пользовательскую часть, административную панель и базу данных для хранения информации о товарах, клиентах, заказах и поставщиках.'
            ],
            advantages: [
                {
                    title: 'Качественное оборудование',
                    text: 'В каталоге представлены категории медицинской техники для диагностики, лабораторной и хирургической деятельности.'
                },
                {
                    title: 'Удобная работа с заказами',
                    text: 'Система позволяет оформлять заказы, изменять их статусы и контролировать состав заказа.'
                },
                {
                    title: 'Централизованная база данных',
                    text: 'Информация о товарах, клиентах, поставщиках и оплатах хранится в единой структуре данных.'
                },
                {
                    title: 'Административная панель',
                    text: 'Для сотрудников предусмотрены инструменты управления товарами, клиентами, заказами и поставщиками.'
                }
            ],
            cooperationBenefits: [
                'Быстрый доступ к каталогу медицинского оборудования.',
                'Возможность оформления заказа через интернет-ресурс.',
                'Контроль статусов заказов и оплат.',
                'Структурированное хранение данных в базе данных.',
                'Возможность дальнейшего расширения функциональности.'
            ]
        }
    });
});

app.post('/api/feedback', async (req, res) => {

    try {

        const { name, phone, email, message } = req.body;

        if (!name || !phone || !message) {
            return res.status(400).json({
                success: false,
                error: 'Заполните имя, телефон и сообщение'
            });
        }

        

       const transporter = nodemailer.createTransport({
    host: 'smtp.mail.ru',
    port: 465,
    secure: true,
    auth: {
        user: 'vitaequip12@mail.ru',
        pass: 'ctgGBECRSbd9nQzb8M5W'
    },
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
});
await transporter.verify();
        await transporter.sendMail({
            from: 'vitaequip12@mail.ru',
to: 'vitaequip12@mail.ru',
            subject: 'Новое сообщение с сайта VitaEquip',
            html: `
                <h2>Новое сообщение с сайта VitaEquip</h2>

                <p><b>Имя:</b> ${name}</p>

                <p><b>Телефон:</b> ${phone}</p>

                <p><b>Email:</b> ${email || 'Не указан'}</p>

                <p><b>Сообщение:</b></p>

                <div style="padding:15px;background:#f4f4f4;border-radius:8px;">
                    ${message}
                </div>
            `
        });

        res.json({
            success: true,
            message: 'Сообщение отправлено'
        });

    } catch (error) {

        console.error('Ошибка отправки сообщения:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }

});
function getFilesRecursive(dir, base = '') {
    if (!fs.existsSync(dir)) return [];

    let result = [];

    for (const item of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, item);
        const relativePath = path.join(base, item).replace(/\\/g, '/');

        if (fs.statSync(fullPath).isDirectory()) {
            result = result.concat(getFilesRecursive(fullPath, relativePath));
        } else {
            result.push(relativePath);
        }
    }

    return result;
}

app.get('/api/uploads', (req, res) => {
    res.json(getFilesRecursive(uploadsDir));
});

app.get('/api/categories', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT
                c.CATEGORY_ID AS id,
                c.NAME AS name,
                NULL AS description,
                COUNT(p.PRODUCT_ID) AS product_count
            FROM PRODUCT_CATEGORIES c
            LEFT JOIN PRODUCTS p ON p.CATEGORY_ID = c.CATEGORY_ID
            GROUP BY c.CATEGORY_ID, c.NAME
            ORDER BY c.NAME
        `);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Ошибка /api/categories:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки категорий'
        });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page || '1', 10), 1);
        const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
        const offset = (page - 1) * limit;
        const categoryId = req.query.category_id ? Number(req.query.category_id) : null;

        let whereSql = '';
        let params = [];

        if (categoryId) {
            whereSql = 'WHERE p.CATEGORY_ID = ?';
            params.push(categoryId);
        }

        const products = await dbAll(`
            SELECT
                p.PRODUCT_ID AS id,
                p.CATEGORY_ID AS category_id,
                c.NAME AS category_name,
                p.NAME AS name,
                p.CURRENT_SALE_PRICE AS price,
                p.CURRENT_PURCHASE_PRICE AS purchase_price,
                p.DESCRIPTION AS description,
                p.IMAGE AS image,
                p.MANUFACTURER AS manufacturer,
                p.EXECUTION_TYPE AS execution_type,
                p.SYSTEM_CLASS AS system_class,
                p.MONITOR_SIZE AS monitor_size,
                p.ACTIVE_PORTS AS active_ports,
                p.WEIGHT AS weight
            FROM PRODUCTS p
            JOIN PRODUCT_CATEGORIES c ON c.CATEGORY_ID = p.CATEGORY_ID
            ${whereSql}
            ORDER BY p.PRODUCT_ID DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const totalRow = await dbGet(`
            SELECT COUNT(*) AS total
            FROM PRODUCTS p
            ${whereSql}
        `, params);

        res.json({
            success: true,
            data: {
                products: products.map(p => ({
                    ...p,
                    images: p.image ? [p.image] : []
                })),
                total: totalRow.total,
                page,
                totalPages: Math.max(Math.ceil(totalRow.total / limit), 1)
            }
        });
    } catch (error) {
        console.error('Ошибка /api/products:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки товаров'
        });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const product = await dbGet(`
            SELECT
                p.PRODUCT_ID AS id,
                p.CATEGORY_ID AS category_id,
                c.NAME AS category_name,
                p.NAME AS name,
                p.CURRENT_SALE_PRICE AS price,
                p.CURRENT_PURCHASE_PRICE AS purchase_price,
                p.DESCRIPTION AS description,
                p.IMAGE AS image,
                p.MANUFACTURER AS manufacturer,
                p.EXECUTION_TYPE AS execution_type,
                p.SYSTEM_CLASS AS system_class,
                p.MONITOR_SIZE AS monitor_size,
                p.ACTIVE_PORTS AS active_ports,
                p.WEIGHT AS weight
            FROM PRODUCTS p
            JOIN PRODUCT_CATEGORIES c ON c.CATEGORY_ID = p.CATEGORY_ID
            WHERE p.PRODUCT_ID = ?
        `, [Number(req.params.id)]);

        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Товар не найден'
            });
        }

        res.json({
            success: true,
            data: {
                ...product,
                images: product.image ? [product.image] : []
            }
        });
    } catch (error) {
        console.error('Ошибка /api/products/:id:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки товара'
        });
    }
});

app.post('/api/upload-image', adminAuth, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            error: 'Файл не выбран'
        });
    }

    res.json({
        success: true,
        filePath: '/uploads/' + req.file.filename
    });
});

app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Введите логин и пароль'
            });
        }

        const user = await dbGet(`
            SELECT USER_ID, FULL_NAME, LOGIN
            FROM USERS
            WHERE LOGIN = ? AND PASSWORD = ?
        `, [username, sha1(password)]);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Неверный логин или пароль'
            });
        }

        const role = user.LOGIN === 'admin' ? 'admin' : 'user';

        if (role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Доступ в админ-панель разрешён только администратору'
            });
        }

        const token = jwt.sign(
            {
                userId: user.USER_ID,
                login: user.LOGIN,
                role
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.USER_ID,
                fullName: user.FULL_NAME,
                login: user.LOGIN,
                role
            }
        });
    } catch (error) {
        console.error('Ошибка /api/admin/login:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
        });
    }
});

app.post('/api/products', adminAuth, async (req, res) => {
    try {
        const {
            name,
            manufacturer,
            category_id,
            execution_type,
            system_class,
            monitor_size,
            active_ports,
            weight,
            price,
            description,
            image
        } = req.body;

        if (!name || !category_id || !price) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название, категорию и цену'
            });
        }

        await dbRun(`
            INSERT INTO PRODUCTS (
                CATEGORY_ID,
                NAME,
                CURRENT_SALE_PRICE,
                CURRENT_PURCHASE_PRICE,
                DESCRIPTION,
                IMAGE,
                MANUFACTURER,
                EXECUTION_TYPE,
                SYSTEM_CLASS,
                MONITOR_SIZE,
                ACTIVE_PORTS,
                WEIGHT
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            Number(category_id),
            name,
            Number(price),
            Number(req.body.purchase_price || price),
            description || null,
            image || null,
            manufacturer || null,
            execution_type || null,
            system_class || null,
            monitor_size || null,
            active_ports || null,
            weight || null
        ]);

        res.json({
            success: true,
            message: 'Товар добавлен'
        });
    } catch (error) {
        console.error('Ошибка POST /api/products:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка добавления товара'
        });
    }
});

app.put('/api/products/:id', adminAuth, async (req, res) => {
    try {
        const {
            name,
            manufacturer,
            category_id,
            execution_type,
            system_class,
            monitor_size,
            active_ports,
            weight,
            price,
            description,
            image
        } = req.body;

        if (!name || !category_id || !price) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название, категорию и цену'
            });
        }

        await dbRun(`
            UPDATE PRODUCTS
            SET CATEGORY_ID = ?,
                NAME = ?,
                CURRENT_SALE_PRICE = ?,
                CURRENT_PURCHASE_PRICE = ?,
                DESCRIPTION = ?,
                IMAGE = ?,
                MANUFACTURER = ?,
                EXECUTION_TYPE = ?,
                SYSTEM_CLASS = ?,
                MONITOR_SIZE = ?,
                ACTIVE_PORTS = ?,
                WEIGHT = ?
            WHERE PRODUCT_ID = ?
        `, [
            Number(category_id),
            name,
            Number(price),
            Number(req.body.purchase_price || price),
            description || null,
            image || null,
            manufacturer || null,
            execution_type || null,
            system_class || null,
            monitor_size || null,
            active_ports || null,
            weight || null,
            Number(req.params.id)
        ]);

        res.json({
            success: true,
            message: 'Товар обновлён'
        });
    } catch (error) {
        console.error('Ошибка PUT /api/products/:id:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка обновления товара'
        });
    }
});

app.delete('/api/products/:id', adminAuth, async (req, res) => {
    try {
        const productId = Number(req.params.id);
        const product = await dbGet(`SELECT IMAGE FROM PRODUCTS WHERE PRODUCT_ID = ?`, [productId]);

        await dbRun(`DELETE FROM ORDER_ITEMS WHERE PRODUCT_ID = ?`, [productId]);
        await dbRun(`DELETE FROM SUPPLY_ITEMS WHERE PRODUCT_ID = ?`, [productId]);
        await dbRun(`DELETE FROM PRODUCTS WHERE PRODUCT_ID = ?`, [productId]);

        if (product && product.IMAGE && product.IMAGE.startsWith('/uploads/')) {
            const fullImagePath = path.join(__dirname, product.IMAGE.replace(/^\//, ''));

            if (fs.existsSync(fullImagePath)) {
                fs.unlinkSync(fullImagePath);
            }
        }

        res.json({
            success: true,
            message: 'Товар удалён'
        });
    } catch (error) {
        console.error('Ошибка DELETE /api/products/:id:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка удаления товара'
        });
    }
});

app.get('/api/customers', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT
                c.CUSTOMER_ID,
                c.USER_ID,
                u.FULL_NAME,
                u.PHONE,
                u.EMAIL,
                u.LOGIN,
                c.DELIVERY_ADDRESS
            FROM CUSTOMERS c
            JOIN USERS u ON u.USER_ID = c.USER_ID
            ORDER BY u.FULL_NAME
        `);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Ошибка GET /api/customers:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки клиентов'
        });
    }
});

app.post('/api/customers', adminAuth, async (req, res) => {
    try {
        const {
            full_name,
            phone,
            email,
            login,
            password,
            delivery_address
        } = req.body;

        if (!full_name || !phone || !email || !login || !password || !delivery_address) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }

        const result = await dbRun(`
            INSERT INTO USERS (FULL_NAME, PHONE, EMAIL, LOGIN, PASSWORD)
            VALUES (?, ?, ?, ?, ?)
        `, [
            full_name,
            phone,
            email,
            login,
            sha1(password)
        ]);

        await dbRun(`
            INSERT INTO CUSTOMERS (USER_ID, DELIVERY_ADDRESS)
            VALUES (?, ?)
        `, [
            result.lastID,
            delivery_address
        ]);

        res.json({
            success: true,
            message: 'Клиент добавлен'
        });
    } catch (error) {
        console.error('Ошибка POST /api/customers:', error);

        const duplicate = String(error.message || '').includes('UNIQUE');

        res.status(500).json({
            success: false,
            error: duplicate
                ? 'Клиент с таким логином или email уже существует'
                : 'Ошибка добавления клиента'
        });
    }
});

app.put('/api/customers/:id', adminAuth, async (req, res) => {
    try {
        const {
            full_name,
            phone,
            email,
            login,
            password,
            delivery_address
        } = req.body;

        const userId = Number(req.params.id);

        if (!full_name || !phone || !email || !login || !delivery_address) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }

        if (password && password.trim() !== '') {
            await dbRun(`
                UPDATE USERS
                SET FULL_NAME = ?, PHONE = ?, EMAIL = ?, LOGIN = ?, PASSWORD = ?
                WHERE USER_ID = ?
            `, [
                full_name,
                phone,
                email,
                login,
                sha1(password),
                userId
            ]);
        } else {
            await dbRun(`
                UPDATE USERS
                SET FULL_NAME = ?, PHONE = ?, EMAIL = ?, LOGIN = ?
                WHERE USER_ID = ?
            `, [
                full_name,
                phone,
                email,
                login,
                userId
            ]);
        }

        await dbRun(`
            UPDATE CUSTOMERS
            SET DELIVERY_ADDRESS = ?
            WHERE USER_ID = ?
        `, [
            delivery_address,
            userId
        ]);

        res.json({
            success: true,
            message: 'Клиент обновлён'
        });
    } catch (error) {
        console.error('Ошибка PUT /api/customers/:id:', error);

        const duplicate = String(error.message || '').includes('UNIQUE');

        res.status(500).json({
            success: false,
            error: duplicate
                ? 'Клиент с таким логином или email уже существует'
                : 'Ошибка обновления клиента'
        });
    }
});

app.delete('/api/customers/:id', adminAuth, async (req, res) => {
    try {
        const userId = Number(req.params.id);
        const customer = await dbGet(`SELECT CUSTOMER_ID FROM CUSTOMERS WHERE USER_ID = ?`, [userId]);

        if (customer) {
            const orders = await dbAll(`SELECT ORDER_ID FROM ORDERS WHERE CUSTOMER_ID = ?`, [customer.CUSTOMER_ID]);

            for (const order of orders) {
                await dbRun(`DELETE FROM ORDER_ITEMS WHERE ORDER_ID = ?`, [order.ORDER_ID]);
                await dbRun(`DELETE FROM PAYMENTS WHERE ORDER_ID = ?`, [order.ORDER_ID]);
            }

            await dbRun(`DELETE FROM ORDERS WHERE CUSTOMER_ID = ?`, [customer.CUSTOMER_ID]);
            await dbRun(`DELETE FROM CUSTOMERS WHERE USER_ID = ?`, [userId]);
        }

        await dbRun(`DELETE FROM USERS WHERE USER_ID = ?`, [userId]);

        res.json({
            success: true,
            message: 'Клиент удалён'
        });
    } catch (error) {
        console.error('Ошибка DELETE /api/customers/:id:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка удаления клиента'
        });
    }
});

app.get('/api/order-statuses', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT ORDER_STATUS_ID AS id, NAME AS name
            FROM ORDER_STATUSES
            ORDER BY ORDER_STATUS_ID
        `);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Ошибка GET /api/order-statuses:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки статусов заказов'
        });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT
                o.ORDER_ID,
                o.CUSTOMER_ID,
                o.ORDER_DATE,
                o.ORDER_STATUS_ID,
                s.NAME AS ORDER_STATUS,
                u.FULL_NAME AS CUSTOMER_NAME,
                IFNULL(SUM(oi.SALE_PRICE_AT_TIME * oi.QUANTITY), 0) AS TOTAL_SUM
            FROM ORDERS o
            JOIN CUSTOMERS c ON c.CUSTOMER_ID = o.CUSTOMER_ID
            JOIN USERS u ON u.USER_ID = c.USER_ID
            JOIN ORDER_STATUSES s ON s.ORDER_STATUS_ID = o.ORDER_STATUS_ID
            LEFT JOIN ORDER_ITEMS oi ON oi.ORDER_ID = o.ORDER_ID
            GROUP BY o.ORDER_ID, o.CUSTOMER_ID, o.ORDER_DATE, o.ORDER_STATUS_ID, s.NAME, u.FULL_NAME
            ORDER BY o.ORDER_ID DESC
        `);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Ошибка GET /api/orders:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки заказов'
        });
    }
});

app.post('/api/orders', adminAuth, async (req, res) => {
    try {
        const {
            customer_id,
            order_status_id,
            order_date
        } = req.body;

        if (!customer_id) {
            return res.status(400).json({
                success: false,
                error: 'Не выбран клиент'
            });
        }

        const customer = await dbGet(
            `SELECT CUSTOMER_ID FROM CUSTOMERS WHERE CUSTOMER_ID = ?`,
            [Number(customer_id)]
        );

        if (!customer) {
            return res.status(400).json({
                success: false,
                error: 'Клиент не найден'
            });
        }

        const statusId = Number(order_status_id || 1);

        const status = await dbGet(
            `SELECT ORDER_STATUS_ID FROM ORDER_STATUSES WHERE ORDER_STATUS_ID = ?`,
            [statusId]
        );

        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Статус заказа не найден'
            });
        }

        let finalOrderDate = new Date().toISOString();

        if (order_date) {
            const parsedDate = new Date(order_date);

            if (Number.isNaN(parsedDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Некорректная дата заказа'
                });
            }

            finalOrderDate = parsedDate.toISOString();
        }

        const result = await dbRun(`
            INSERT INTO ORDERS (CUSTOMER_ID, ORDER_DATE, ORDER_STATUS_ID)
            VALUES (?, ?, ?)
        `, [
            Number(customer_id),
            finalOrderDate,
            statusId
        ]);

        res.json({
            success: true,
            order_id: result.lastID,
            message: 'Заказ создан'
        });
    } catch (error) {
        console.error('Ошибка создания заказа:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка создания заказа'
        });
    }
});

app.post('/api/orders/:id/items', adminAuth, async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const { product_id, quantity } = req.body;

        if (!orderId || orderId <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный ID заказа'
            });
        }

        if (!product_id || !quantity || Number(quantity) <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Не выбран товар или указано неверное количество'
            });
        }

        const order = await dbGet(
            `SELECT ORDER_ID FROM ORDERS WHERE ORDER_ID = ?`,
            [orderId]
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Заказ не найден'
            });
        }

        const product = await dbGet(`
            SELECT PRODUCT_ID, CURRENT_SALE_PRICE
            FROM PRODUCTS
            WHERE PRODUCT_ID = ?
        `, [
            Number(product_id)
        ]);

        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Товар не найден'
            });
        }

        const exists = await dbGet(`
            SELECT ORDER_ID, PRODUCT_ID
            FROM ORDER_ITEMS
            WHERE ORDER_ID = ? AND PRODUCT_ID = ?
        `, [
            orderId,
            Number(product_id)
        ]);

        if (exists) {
            await dbRun(`
                UPDATE ORDER_ITEMS
                SET QUANTITY = QUANTITY + ?
                WHERE ORDER_ID = ? AND PRODUCT_ID = ?
            `, [
                Number(quantity),
                orderId,
                Number(product_id)
            ]);
        } else {
            await dbRun(`
                INSERT INTO ORDER_ITEMS (ORDER_ID, PRODUCT_ID, SALE_PRICE_AT_TIME, QUANTITY)
                VALUES (?, ?, ?, ?)
            `, [
                orderId,
                Number(product_id),
                Number(product.CURRENT_SALE_PRICE),
                Number(quantity)
            ]);
        }

        res.json({
            success: true,
            message: 'Товар добавлен в заказ'
        });
    } catch (error) {
        console.error('Ошибка добавления товара в заказ:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка добавления товара в заказ'
        });
    }
});

app.get('/api/orders/:id/items', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT
                oi.ORDER_ID,
                oi.PRODUCT_ID,
                p.NAME AS PRODUCT_NAME,
                oi.SALE_PRICE_AT_TIME,
                oi.QUANTITY,
                oi.SALE_PRICE_AT_TIME * oi.QUANTITY AS TOTAL_SUM
            FROM ORDER_ITEMS oi
            JOIN PRODUCTS p ON p.PRODUCT_ID = oi.PRODUCT_ID
            WHERE oi.ORDER_ID = ?
            ORDER BY p.NAME
        `, [
            Number(req.params.id)
        ]);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Ошибка GET /api/orders/:id/items:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки состава заказа'
        });
    }
});

app.put('/api/orders/:id/status', adminAuth, async (req, res) => {
    try {
        const { order_status_id } = req.body;
        const orderId = Number(req.params.id);

        if (!order_status_id) {
            return res.status(400).json({
                success: false,
                error: 'Не выбран новый статус'
            });
        }

        const order = await dbGet(
            `SELECT ORDER_ID FROM ORDERS WHERE ORDER_ID = ?`,
            [orderId]
        );

        if (!order) {
            return res.status(400).json({
                success: false,
                error: 'Заказ не найден'
            });
        }

        const status = await dbGet(
            `SELECT ORDER_STATUS_ID FROM ORDER_STATUSES WHERE ORDER_STATUS_ID = ?`,
            [Number(order_status_id)]
        );

        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'Статус не найден'
            });
        }

        await dbRun(`
            UPDATE ORDERS
            SET ORDER_STATUS_ID = ?
            WHERE ORDER_ID = ?
        `, [
            Number(order_status_id),
            orderId
        ]);

        res.json({
            success: true,
            message: 'Статус заказа обновлён'
        });
    } catch (error) {
        console.error('Ошибка PUT /api/orders/:id/status:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка обновления статуса заказа'
        });
    }
});

app.delete('/api/orders/:id', adminAuth, async (req, res) => {
    try {
        const orderId = Number(req.params.id);

        await dbRun(`DELETE FROM ORDER_ITEMS WHERE ORDER_ID = ?`, [orderId]);
        await dbRun(`DELETE FROM PAYMENTS WHERE ORDER_ID = ?`, [orderId]);
        await dbRun(`DELETE FROM ORDERS WHERE ORDER_ID = ?`, [orderId]);

        res.json({
            success: true,
            message: 'Заказ удалён'
        });
    } catch (error) {
        console.error('Ошибка DELETE /api/orders/:id:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка удаления заказа'
        });
    }
});

app.get('/api/suppliers', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT SUPPLIER_ID, NAME, LEGAL_ADDRESS
            FROM SUPPLIERS
            ORDER BY NAME
        `);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Ошибка GET /api/suppliers:', error);

        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки поставщиков'
        });
    }
});

app.post('/api/suppliers', adminAuth, async (req, res) => {
    try {
        const {
            name,
            legal_address
        } = req.body;

        if (!name || !legal_address) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название и юридический адрес'
            });
        }

        await dbRun(`
            INSERT INTO SUPPLIERS (NAME, LEGAL_ADDRESS)
            VALUES (?, ?)
        `, [
            name,
            legal_address
        ]);

        res.json({
            success: true,
            message: 'Поставщик добавлен'
        });
    } catch (error) {
        console.error('Ошибка POST /api/suppliers:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка добавления поставщика'
        });
    }
});

app.put('/api/suppliers/:id', adminAuth, async (req, res) => {
    try {
        const supplierId = Number(req.params.id);

        const {
            name,
            legal_address
        } = req.body;

        if (!supplierId || !name || !legal_address) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }

        await dbRun(`
            UPDATE SUPPLIERS
            SET NAME = ?, LEGAL_ADDRESS = ?
            WHERE SUPPLIER_ID = ?
        `, [
            name,
            legal_address,
            supplierId
        ]);

        res.json({
            success: true,
            message: 'Поставщик обновлён'
        });
    } catch (error) {
        console.error('Ошибка PUT /api/suppliers/:id:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка обновления поставщика'
        });
    }
});

app.delete('/api/suppliers/:id', adminAuth, async (req, res) => {
    try {
        const supplierId = Number(req.params.id);

        const supplies = await dbAll(
            `SELECT SUPPLY_ID FROM SUPPLIES WHERE SUPPLIER_ID = ?`,
            [supplierId]
        );

        for (const supply of supplies) {
            await dbRun(
                `DELETE FROM SUPPLY_ITEMS WHERE SUPPLY_ID = ?`,
                [supply.SUPPLY_ID]
            );
        }

        await dbRun(`DELETE FROM SUPPLIES WHERE SUPPLIER_ID = ?`, [supplierId]);
        await dbRun(`DELETE FROM SUPPLIERS WHERE SUPPLIER_ID = ?`, [supplierId]);

        res.json({
            success: true,
            message: 'Поставщик удалён'
        });
    } catch (error) {
        console.error('Ошибка DELETE /api/suppliers/:id:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка удаления поставщика'
        });
    }
});

app.get('/api/stats/summary', async (req, res) => {
    try {
        const productsRes = await dbGet(`SELECT COUNT(*) AS count FROM PRODUCTS`);
        const customersRes = await dbGet(`SELECT COUNT(*) AS count FROM CUSTOMERS`);
        const ordersRes = await dbGet(`SELECT COUNT(*) AS count FROM ORDERS`);
        const suppliersRes = await dbGet(`SELECT COUNT(*) AS count FROM SUPPLIERS`);

        const totalOrdersSumRes = await dbGet(`
            SELECT IFNULL(SUM(SALE_PRICE_AT_TIME * QUANTITY), 0) AS total_sum
            FROM ORDER_ITEMS
        `);

        const monthlyRows = await dbAll(`
            SELECT
                strftime('%Y', o.ORDER_DATE) AS order_year,
                strftime('%m', o.ORDER_DATE) AS order_month,
                IFNULL(SUM(oi.SALE_PRICE_AT_TIME * oi.QUANTITY), 0) AS total_sum
            FROM ORDERS o
            LEFT JOIN ORDER_ITEMS oi ON oi.ORDER_ID = o.ORDER_ID
            GROUP BY strftime('%Y', o.ORDER_DATE), strftime('%m', o.ORDER_DATE)
            ORDER BY strftime('%Y', o.ORDER_DATE), strftime('%m', o.ORDER_DATE)
        `);

        const monthlySales = monthlyRows.map(item => ({
            month_key: `${item.order_year}-${item.order_month}`,
            month_label: `${item.order_month}.${item.order_year}`,
            total_sum: item.total_sum
        }));

        res.json({
            success: true,
            data: {
                products_count: productsRes.count,
                customers_count: customersRes.count,
                orders_count: ordersRes.count,
                suppliers_count: suppliersRes.count,
                total_orders_sum: totalOrdersSumRes.total_sum,
                monthly_sales: monthlySales
            }
        });
    } catch (error) {
        console.error('Ошибка /api/stats/summary:', error);

        res.status(500).json({
            success: false,
            error: error.message || 'Ошибка загрузки статистики'
        });
    }
});

app.use((err, req, res, next) => {
    console.error('Глобальная ошибка:', err);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            error: err.message
        });
    }

    if (err.message === 'Разрешены только изображения JPG, JPEG, PNG и WEBP') {
        return res.status(400).json({
            success: false,
            error: err.message
        });
    }

    res.status(500).json({
        success: false,
        error: err.message || 'Внутренняя ошибка сервера'
    });
});

initDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Сервер запущен на порту ${PORT}`);
            console.log(`База SQLite: ${dbPath}`);
        });
    })
    .catch(error => {
        console.error('Ошибка инициализации базы данных:', error);
        process.exit(1);
    });