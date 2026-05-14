require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const sql = require('mssql');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'medicalequipmentstore_jwt_secret';
const SESSION_SECRET = process.env.SESSION_SECRET || 'medicalequipmentstore_secret';

const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

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
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();

        if (!allowed.includes(ext)) {
            return cb(new Error('Разрешены только изображения JPG, JPEG, PNG и WEBP'));
        }

        cb(null, true);
    }
});

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || process.env.DB_NAME || 'MedicalEquipmentStore',
    port: Number(process.env.DB_PORT || 1433),
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let pool;

async function getPool() {
    if (pool) {
        return pool;
    }

    pool = await sql.connect(dbConfig);
    return pool;
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
            database: 'SQL Server',
            version: '1.0.0'
        }
    });
});

app.get('/api/health', async (req, res) => {
    try {
        const db = await getPool();
        await db.request().query('SELECT 1 AS ok');
        res.json({ success: true, database: 'connected' });
    } catch (error) {
        res.status(500).json({ success: false, database: 'disconnected', error: error.message });
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
                'Интернет-ресурс объединяет пользовательскую часть, административную панель и базу данных Microsoft SQL Server для хранения информации о товарах, клиентах, заказах и поставщиках.'
            ],
            advantages: [
                { title: 'Качественное оборудование', text: 'В каталоге представлены категории медицинской техники для диагностики, лабораторной и хирургической деятельности.' },
                { title: 'Удобная работа с заказами', text: 'Система позволяет оформлять заказы, изменять их статусы и контролировать состав заказа.' },
                { title: 'Централизованная база данных', text: 'Информация о товарах, клиентах, поставщиках и оплатах хранится в единой структуре данных.' },
                { title: 'Административная панель', text: 'Для сотрудников предусмотрены инструменты управления товарами, клиентами, заказами и поставщиками.' }
            ],
            cooperationBenefits: [
                'Быстрый доступ к каталогу медицинского оборудования.',
                'Возможность оформления заказа через интернет-ресурс.',
                'Контроль статусов заказов и оплат.',
                'Структурированное хранение данных в Microsoft SQL Server.',
                'Возможность дальнейшего расширения функциональности.'
            ]
        }
    });
});

app.post('/api/feedback', (req, res) => {
    const { name, phone, email, message } = req.body || {};

    if (!name || !phone || !message) {
        return res.status(400).json({
            success: false,
            error: 'Заполните имя, телефон и сообщение'
        });
    }

    const feedbackFile = path.join(__dirname, 'feedback.json');
    let feedback = [];

    try {
        if (fs.existsSync(feedbackFile)) {
            feedback = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
        }
    } catch (error) {
        feedback = [];
    }

    feedback.push({
        id: Date.now(),
        name,
        phone,
        email: email || '',
        message,
        created_at: new Date().toISOString()
    });

    fs.writeFileSync(feedbackFile, JSON.stringify(feedback, null, 2), 'utf8');

    res.json({
        success: true,
        message: 'Сообщение сохранено'
    });
});

app.get('/api/uploads', (req, res) => {
    if (!fs.existsSync(uploadsDir)) {
        return res.json([]);
    }

    const files = fs.readdirSync(uploadsDir).filter(Boolean);
    res.json(files);
});

app.get('/api/categories', async (req, res) => {
    try {
        const db = await getPool();

        const result = await db.request().query(`
            SELECT
                c.CATEGORY_ID AS id,
                c.NAME AS name,
                CAST(NULL AS NVARCHAR(255)) AS description,
                COUNT(p.PRODUCT_ID) AS product_count
            FROM PRODUCT_CATEGORIES c
            LEFT JOIN PRODUCTS p ON p.CATEGORY_ID = c.CATEGORY_ID
            GROUP BY c.CATEGORY_ID, c.NAME
            ORDER BY c.NAME
        `);

        res.json({
            success: true,
            data: result.recordset
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
        const db = await getPool();

        const page = Math.max(parseInt(req.query.page || '1', 10), 1);
        const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
        const offset = (page - 1) * limit;
        const categoryId = req.query.category_id ? Number(req.query.category_id) : null;

        let whereSql = '';
        const request = db.request();

        if (categoryId) {
            request.input('categoryId', sql.Int, categoryId);
            whereSql = 'WHERE p.CATEGORY_ID = @categoryId';
        }

        request.input('offset', sql.Int, offset);
        request.input('limit', sql.Int, limit);

        const dataQuery = `
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
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
        `;

        const countRequest = db.request();
        if (categoryId) {
            countRequest.input('categoryId', sql.Int, categoryId);
        }

        const countQuery = `
            SELECT COUNT(*) AS total
            FROM PRODUCTS p
            ${whereSql};
        `;

        const [dataResult, countResult] = await Promise.all([
            request.query(dataQuery),
            countRequest.query(countQuery)
        ]);

        const products = dataResult.recordset.map(p => ({
            ...p,
            images: p.image ? [p.image] : []
        }));

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                products,
                total,
                page,
                totalPages: Math.max(Math.ceil(total / limit), 1)
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
        const db = await getPool();
        const request = db.request();

        request.input('id', sql.Int, Number(req.params.id));

        const result = await request.query(`
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
            WHERE p.PRODUCT_ID = @id
        `);

        if (!result.recordset.length) {
            return res.status(404).json({
                success: false,
                error: 'Товар не найден'
            });
        }

        const product = result.recordset[0];

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
    try {
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
    } catch (error) {
        console.error('Ошибка /api/upload-image:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки изображения'
        });
    }
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

        const db = await getPool();
        const request = db.request();

        request.input('login', sql.NVarChar(50), username);
        request.input('password', sql.Char(40), sha1(password));

        const result = await request.query(`
            SELECT USER_ID, FULL_NAME, LOGIN
            FROM USERS
            WHERE LOGIN = @login AND PASSWORD = @password
        `);

        if (!result.recordset.length) {
            return res.status(401).json({
                success: false,
                error: 'Неверный логин или пароль'
            });
        }

        const user = result.recordset[0];
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

        const db = await getPool();
        const request = db.request();

        request.input('categoryId', sql.Int, Number(category_id));
        request.input('name', sql.NVarChar(150), name);
        request.input('manufacturer', sql.NVarChar(150), manufacturer || null);
        request.input('executionType', sql.NVarChar(100), execution_type || null);
        request.input('systemClass', sql.NVarChar(100), system_class || null);
        request.input('monitorSize', sql.NVarChar(100), monitor_size || null);
        request.input('activePorts', sql.NVarChar(200), active_ports || null);
        request.input('weight', sql.NVarChar(50), weight || null);
        request.input('salePrice', sql.Decimal(10, 2), Number(price));
        request.input('purchasePrice', sql.Decimal(10, 2), Number(req.body.purchase_price || price));
        request.input('description', sql.NVarChar(sql.MAX), description || null);
        request.input('image', sql.NVarChar(255), image || null);

        await request.query(`
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
            VALUES (
                @categoryId,
                @name,
                @salePrice,
                @purchasePrice,
                @description,
                @image,
                @manufacturer,
                @executionType,
                @systemClass,
                @monitorSize,
                @activePorts,
                @weight
            )
        `);

        res.json({
            success: true,
            message: 'Товар добавлен'
        });
    } catch (error) {
        console.error('Ошибка POST /api/products:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка добавления товара'
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

        const db = await getPool();
        const request = db.request();

        request.input('id', sql.Int, Number(req.params.id));
        request.input('categoryId', sql.Int, Number(category_id));
        request.input('name', sql.NVarChar(150), name);
        request.input('manufacturer', sql.NVarChar(150), manufacturer || null);
        request.input('executionType', sql.NVarChar(100), execution_type || null);
        request.input('systemClass', sql.NVarChar(100), system_class || null);
        request.input('monitorSize', sql.NVarChar(100), monitor_size || null);
        request.input('activePorts', sql.NVarChar(200), active_ports || null);
        request.input('weight', sql.NVarChar(50), weight || null);
        request.input('salePrice', sql.Decimal(10, 2), Number(price));
        request.input('purchasePrice', sql.Decimal(10, 2), Number(req.body.purchase_price || price));
        request.input('description', sql.NVarChar(sql.MAX), description || null);
        request.input('image', sql.NVarChar(255), image || null);

        await request.query(`
            UPDATE PRODUCTS
            SET CATEGORY_ID = @categoryId,
                NAME = @name,
                CURRENT_SALE_PRICE = @salePrice,
                CURRENT_PURCHASE_PRICE = @purchasePrice,
                DESCRIPTION = @description,
                IMAGE = @image,
                MANUFACTURER = @manufacturer,
                EXECUTION_TYPE = @executionType,
                SYSTEM_CLASS = @systemClass,
                MONITOR_SIZE = @monitorSize,
                ACTIVE_PORTS = @activePorts,
                WEIGHT = @weight
            WHERE PRODUCT_ID = @id
        `);

        res.json({
            success: true,
            message: 'Товар обновлён'
        });
    } catch (error) {
        console.error('Ошибка PUT /api/products/:id:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка обновления товара'
        });
    }
});

app.delete('/api/products/:id', adminAuth, async (req, res) => {
    const productId = Number(req.params.id);

    try {
        const db = await getPool();

        const productResult = await db.request()
            .input('id', sql.Int, productId)
            .query(`
                SELECT IMAGE
                FROM PRODUCTS
                WHERE PRODUCT_ID = @id
            `);

        const imagePath = productResult.recordset.length
            ? productResult.recordset[0].IMAGE
            : null;

        const tx = new sql.Transaction(db);
        await tx.begin();

        try {
            await new sql.Request(tx)
                .input('id', sql.Int, productId)
                .query('DELETE FROM ORDER_ITEMS WHERE PRODUCT_ID = @id');

            await new sql.Request(tx)
                .input('id', sql.Int, productId)
                .query('DELETE FROM SUPPLY_ITEMS WHERE PRODUCT_ID = @id');

            await new sql.Request(tx)
                .input('id', sql.Int, productId)
                .query('DELETE FROM PRODUCTS WHERE PRODUCT_ID = @id');

            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        if (imagePath && imagePath.startsWith('/uploads/')) {
            const fullImagePath = path.join(__dirname, imagePath.replace(/^\//, ''));

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
            error: error.originalError?.info?.message || error.message || 'Ошибка удаления товара'
        });
    }
});

app.get('/api/customers', async (req, res) => {
    try {
        const db = await getPool();

        const result = await db.request().query(`
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
            data: result.recordset
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
        const { full_name, phone, email, login, password, delivery_address } = req.body;

        if (!full_name || !phone || !email || !login || !password || !delivery_address) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }

        const db = await getPool();
        const tx = new sql.Transaction(db);

        await tx.begin();

        try {
            const userReq = new sql.Request(tx);
            userReq.input('fullName', sql.NVarChar(150), full_name);
            userReq.input('phone', sql.NVarChar(20), phone);
            userReq.input('email', sql.NVarChar(100), email);
            userReq.input('login', sql.NVarChar(50), login);
            userReq.input('password', sql.Char(40), sha1(password));

            const userResult = await userReq.query(`
                INSERT INTO USERS (FULL_NAME, PHONE, EMAIL, LOGIN, PASSWORD)
                OUTPUT INSERTED.USER_ID
                VALUES (@fullName, @phone, @email, @login, @password)
            `);

            const userId = userResult.recordset[0].USER_ID;

            const customerReq = new sql.Request(tx);
            customerReq.input('userId', sql.Int, userId);
            customerReq.input('address', sql.NVarChar(250), delivery_address);

            await customerReq.query(`
                INSERT INTO CUSTOMERS (USER_ID, DELIVERY_ADDRESS)
                VALUES (@userId, @address)
            `);

            await tx.commit();

            res.json({
                success: true,
                message: 'Клиент добавлен'
            });
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    } catch (error) {
        console.error('Ошибка POST /api/customers:', error);

        const duplicate = String(error.message || '').includes('UNIQUE');

        res.status(500).json({
            success: false,
            error: duplicate
                ? 'Клиент с таким логином или email уже существует'
                : (error.originalError?.info?.message || error.message || 'Ошибка добавления клиента')
        });
    }
});

app.put('/api/customers/:id', adminAuth, async (req, res) => {
    try {
        const { full_name, phone, email, login, password, delivery_address } = req.body;
        const userId = Number(req.params.id);

        if (!full_name || !phone || !email || !login || !delivery_address) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }

        const db = await getPool();
        const tx = new sql.Transaction(db);

        await tx.begin();

        try {
            const userReq = new sql.Request(tx);
            userReq.input('userId', sql.Int, userId);
            userReq.input('fullName', sql.NVarChar(150), full_name);
            userReq.input('phone', sql.NVarChar(20), phone);
            userReq.input('email', sql.NVarChar(100), email);
            userReq.input('login', sql.NVarChar(50), login);

            if (password && password.trim() !== '') {
                userReq.input('password', sql.Char(40), sha1(password));

                await userReq.query(`
                    UPDATE USERS
                    SET FULL_NAME = @fullName,
                        PHONE = @phone,
                        EMAIL = @email,
                        LOGIN = @login,
                        PASSWORD = @password
                    WHERE USER_ID = @userId
                `);
            } else {
                await userReq.query(`
                    UPDATE USERS
                    SET FULL_NAME = @fullName,
                        PHONE = @phone,
                        EMAIL = @email,
                        LOGIN = @login
                    WHERE USER_ID = @userId
                `);
            }

            const customerReq = new sql.Request(tx);
            customerReq.input('userId', sql.Int, userId);
            customerReq.input('address', sql.NVarChar(250), delivery_address);

            await customerReq.query(`
                UPDATE CUSTOMERS
                SET DELIVERY_ADDRESS = @address
                WHERE USER_ID = @userId
            `);

            await tx.commit();

            res.json({
                success: true,
                message: 'Клиент обновлён'
            });
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    } catch (error) {
        console.error('Ошибка PUT /api/customers/:id:', error);

        const duplicate = String(error.message || '').includes('UNIQUE');

        res.status(500).json({
            success: false,
            error: duplicate
                ? 'Клиент с таким логином или email уже существует'
                : (error.originalError?.info?.message || error.message || 'Ошибка обновления клиента')
        });
    }
});

app.delete('/api/customers/:id', adminAuth, async (req, res) => {
    const userId = Number(req.params.id);

    try {
        const db = await getPool();
        const tx = new sql.Transaction(db);

        await tx.begin();

        try {
            const customerResult = await new sql.Request(tx)
                .input('userId', sql.Int, userId)
                .query('SELECT CUSTOMER_ID FROM CUSTOMERS WHERE USER_ID = @userId');

            if (customerResult.recordset.length) {
                const customerId = customerResult.recordset[0].CUSTOMER_ID;

                await new sql.Request(tx)
                    .input('customerId', sql.Int, customerId)
                    .query(`
                        DELETE oi
                        FROM ORDER_ITEMS oi
                        JOIN ORDERS o ON o.ORDER_ID = oi.ORDER_ID
                        WHERE o.CUSTOMER_ID = @customerId
                    `);

                await new sql.Request(tx)
                    .input('customerId', sql.Int, customerId)
                    .query(`
                        DELETE p
                        FROM PAYMENTS p
                        JOIN ORDERS o ON o.ORDER_ID = p.ORDER_ID
                        WHERE o.CUSTOMER_ID = @customerId
                    `);

                await new sql.Request(tx)
                    .input('customerId', sql.Int, customerId)
                    .query('DELETE FROM ORDERS WHERE CUSTOMER_ID = @customerId');

                await new sql.Request(tx)
                    .input('userId', sql.Int, userId)
                    .query('DELETE FROM CUSTOMERS WHERE USER_ID = @userId');
            }

            await new sql.Request(tx)
                .input('userId', sql.Int, userId)
                .query('DELETE FROM USERS WHERE USER_ID = @userId');

            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        res.json({
            success: true,
            message: 'Клиент удалён'
        });
    } catch (error) {
        console.error('Ошибка DELETE /api/customers/:id:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка удаления клиента'
        });
    }
});

app.get('/api/order-statuses', async (req, res) => {
    try {
        const db = await getPool();

        const result = await db.request().query(`
            SELECT
                ORDER_STATUS_ID AS id,
                NAME AS name
            FROM ORDER_STATUSES
            ORDER BY ORDER_STATUS_ID
        `);

        res.json({
            success: true,
            data: result.recordset
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
        const db = await getPool();

        const result = await db.request().query(`
            SELECT
                o.ORDER_ID,
                o.CUSTOMER_ID,
                o.ORDER_DATE,
                o.ORDER_STATUS_ID,
                s.NAME AS ORDER_STATUS,
                u.FULL_NAME AS CUSTOMER_NAME,
                ISNULL(SUM(oi.SALE_PRICE_AT_TIME * oi.QUANTITY), 0) AS TOTAL_SUM
            FROM ORDERS o
            JOIN CUSTOMERS c ON c.CUSTOMER_ID = o.CUSTOMER_ID
            JOIN USERS u ON u.USER_ID = c.USER_ID
            JOIN ORDER_STATUSES s ON s.ORDER_STATUS_ID = o.ORDER_STATUS_ID
            LEFT JOIN ORDER_ITEMS oi ON oi.ORDER_ID = o.ORDER_ID
            GROUP BY
                o.ORDER_ID,
                o.CUSTOMER_ID,
                o.ORDER_DATE,
                o.ORDER_STATUS_ID,
                s.NAME,
                u.FULL_NAME
            ORDER BY o.ORDER_ID DESC
        `);

        res.json({
            success: true,
            data: result.recordset
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
        const { customer_id, order_status_id } = req.body;

        if (!customer_id) {
            return res.status(400).json({
                success: false,
                error: 'Не выбран клиент'
            });
        }

        const db = await getPool();

        const checkCustomer = await db.request()
            .input('customerId', sql.Int, Number(customer_id))
            .query(`
                SELECT CUSTOMER_ID
                FROM CUSTOMERS
                WHERE CUSTOMER_ID = @customerId
            `);

        if (!checkCustomer.recordset.length) {
            return res.status(400).json({
                success: false,
                error: 'Клиент не найден'
            });
        }

        const finalStatusId = Number(order_status_id || 1);

        const checkStatus = await db.request()
            .input('statusId', sql.Int, finalStatusId)
            .query(`
                SELECT ORDER_STATUS_ID
                FROM ORDER_STATUSES
                WHERE ORDER_STATUS_ID = @statusId
            `);

        if (!checkStatus.recordset.length) {
            return res.status(400).json({
                success: false,
                error: 'Статус заказа не найден'
            });
        }

        const result = await db.request()
            .input('customerId', sql.Int, Number(customer_id))
            .input('statusId', sql.Int, finalStatusId)
            .query(`
                INSERT INTO ORDERS (CUSTOMER_ID, ORDER_STATUS_ID)
                OUTPUT INSERTED.ORDER_ID
                VALUES (@customerId, @statusId)
            `);

        res.json({
            success: true,
            order_id: result.recordset[0].ORDER_ID,
            message: 'Заказ создан'
        });
    } catch (error) {
        console.error('Ошибка создания заказа:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка создания заказа'
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

        const db = await getPool();
        const tx = new sql.Transaction(db);

        await tx.begin();

        try {
            const orderReq = new sql.Request(tx);
            orderReq.input('orderId', sql.Int, orderId);

            const orderCheck = await orderReq.query(`
                SELECT ORDER_ID
                FROM ORDERS
                WHERE ORDER_ID = @orderId
            `);

            if (!orderCheck.recordset.length) {
                throw new Error('ORDER_NOT_FOUND');
            }

            const productReq = new sql.Request(tx);
            productReq.input('productId', sql.Int, Number(product_id));

            const product = await productReq.query(`
                SELECT PRODUCT_ID, CURRENT_SALE_PRICE
                FROM PRODUCTS
                WHERE PRODUCT_ID = @productId
            `);

            if (!product.recordset.length) {
                throw new Error('PRODUCT_NOT_FOUND');
            }

            const salePrice = Number(product.recordset[0].CURRENT_SALE_PRICE);

            const itemReq = new sql.Request(tx);
            itemReq.input('orderId', sql.Int, orderId);
            itemReq.input('productId', sql.Int, Number(product_id));
            itemReq.input('salePrice', sql.Decimal(10, 2), salePrice);
            itemReq.input('quantity', sql.Int, Number(quantity));

            await itemReq.query(`
                MERGE ORDER_ITEMS AS target
                USING (
                    SELECT
                        @orderId AS ORDER_ID,
                        @productId AS PRODUCT_ID
                ) AS source
                ON target.ORDER_ID = source.ORDER_ID
                   AND target.PRODUCT_ID = source.PRODUCT_ID
                WHEN MATCHED THEN
                    UPDATE SET QUANTITY = target.QUANTITY + @quantity
                WHEN NOT MATCHED THEN
                    INSERT (ORDER_ID, PRODUCT_ID, SALE_PRICE_AT_TIME, QUANTITY)
                    VALUES (@orderId, @productId, @salePrice, @quantity);
            `);

            await tx.commit();

            res.json({
                success: true,
                message: 'Товар добавлен в заказ'
            });
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    } catch (error) {
        console.error('Ошибка добавления товара в заказ:', error);

        let message = 'Ошибка добавления товара в заказ';

        if (error.message === 'ORDER_NOT_FOUND') {
            message = 'Заказ не найден';
        } else if (error.message === 'PRODUCT_NOT_FOUND') {
            message = 'Товар не найден';
        } else if (error.originalError?.info?.message) {
            message = error.originalError.info.message;
        }

        res.status(500).json({
            success: false,
            error: message
        });
    }
});

app.get('/api/orders/:id/items', async (req, res) => {
    try {
        const db = await getPool();

        const result = await db.request()
            .input('orderId', sql.Int, Number(req.params.id))
            .query(`
                SELECT
                    oi.ORDER_ID,
                    oi.PRODUCT_ID,
                    p.NAME AS PRODUCT_NAME,
                    oi.SALE_PRICE_AT_TIME,
                    oi.QUANTITY,
                    oi.SALE_PRICE_AT_TIME * oi.QUANTITY AS TOTAL_SUM
                FROM ORDER_ITEMS oi
                JOIN PRODUCTS p ON p.PRODUCT_ID = oi.PRODUCT_ID
                WHERE oi.ORDER_ID = @orderId
                ORDER BY p.NAME
            `);

        res.json({
            success: true,
            data: result.recordset
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

        const db = await getPool();

        const checkOrder = await db.request()
            .input('orderId', sql.Int, orderId)
            .query(`
                SELECT ORDER_ID
                FROM ORDERS
                WHERE ORDER_ID = @orderId
            `);

        if (!checkOrder.recordset.length) {
            return res.status(400).json({
                success: false,
                error: 'Заказ не найден'
            });
        }

        const checkStatus = await db.request()
            .input('statusId', sql.Int, Number(order_status_id))
            .query(`
                SELECT ORDER_STATUS_ID
                FROM ORDER_STATUSES
                WHERE ORDER_STATUS_ID = @statusId
            `);

        if (!checkStatus.recordset.length) {
            return res.status(400).json({
                success: false,
                error: 'Статус не найден'
            });
        }

        await db.request()
            .input('orderId', sql.Int, orderId)
            .input('statusId', sql.Int, Number(order_status_id))
            .query(`
                UPDATE ORDERS
                SET ORDER_STATUS_ID = @statusId
                WHERE ORDER_ID = @orderId
            `);

        res.json({
            success: true,
            message: 'Статус заказа обновлён'
        });
    } catch (error) {
        console.error('Ошибка PUT /api/orders/:id/status:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка обновления статуса заказа'
        });
    }
});

app.delete('/api/orders/:id', adminAuth, async (req, res) => {
    const orderId = Number(req.params.id);

    try {
        const db = await getPool();
        const tx = new sql.Transaction(db);

        await tx.begin();

        try {
            await new sql.Request(tx)
                .input('orderId', sql.Int, orderId)
                .query('DELETE FROM ORDER_ITEMS WHERE ORDER_ID = @orderId');

            await new sql.Request(tx)
                .input('orderId', sql.Int, orderId)
                .query('DELETE FROM PAYMENTS WHERE ORDER_ID = @orderId');

            await new sql.Request(tx)
                .input('orderId', sql.Int, orderId)
                .query('DELETE FROM ORDERS WHERE ORDER_ID = @orderId');

            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        res.json({
            success: true,
            message: 'Заказ удалён'
        });
    } catch (error) {
        console.error('Ошибка DELETE /api/orders/:id:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка удаления заказа'
        });
    }
});

app.get('/api/suppliers', async (req, res) => {
    try {
        const db = await getPool();

        const result = await db.request().query(`
            SELECT
                SUPPLIER_ID,
                NAME,
                LEGAL_ADDRESS
            FROM SUPPLIERS
            ORDER BY NAME
        `);

        res.json({
            success: true,
            data: result.recordset
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
        const { name, legal_address } = req.body;

        if (!name || !legal_address) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название и юридический адрес'
            });
        }

        const db = await getPool();

        await db.request()
            .input('name', sql.NVarChar(150), name)
            .input('address', sql.NVarChar(250), legal_address)
            .query(`
                INSERT INTO SUPPLIERS (NAME, LEGAL_ADDRESS)
                VALUES (@name, @address)
            `);

        res.json({
            success: true,
            message: 'Поставщик добавлен'
        });
    } catch (error) {
        console.error('Ошибка POST /api/suppliers:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка добавления поставщика'
        });
    }
});


app.put('/api/suppliers/:id', adminAuth, async (req, res) => {
    try {
        const supplierId = Number(req.params.id);
        const { name, legal_address } = req.body;

        if (!supplierId || !name || !legal_address) {
            return res.status(400).json({ success: false, error: 'Заполните все обязательные поля' });
        }

        const db = await getPool();
        await db.request()
            .input('id', sql.Int, supplierId)
            .input('name', sql.NVarChar(150), name)
            .input('address', sql.NVarChar(250), legal_address)
            .query(`
                UPDATE SUPPLIERS
                SET NAME = @name,
                    LEGAL_ADDRESS = @address
                WHERE SUPPLIER_ID = @id
            `);

        res.json({ success: true, message: 'Поставщик обновлён' });
    } catch (error) {
        console.error('Ошибка PUT /api/suppliers/:id:', error);
        res.status(500).json({ success: false, error: error.originalError?.info?.message || error.message || 'Ошибка обновления поставщика' });
    }
});

app.delete('/api/suppliers/:id', adminAuth, async (req, res) => {
    const supplierId = Number(req.params.id);

    try {
        const db = await getPool();
        const tx = new sql.Transaction(db);

        await tx.begin();

        try {
            await new sql.Request(tx)
                .input('supplierId', sql.Int, supplierId)
                .query(`
                    DELETE si
                    FROM SUPPLY_ITEMS si
                    JOIN SUPPLIES s ON s.SUPPLY_ID = si.SUPPLY_ID
                    WHERE s.SUPPLIER_ID = @supplierId
                `);

            await new sql.Request(tx)
                .input('supplierId', sql.Int, supplierId)
                .query('DELETE FROM SUPPLIES WHERE SUPPLIER_ID = @supplierId');

            await new sql.Request(tx)
                .input('supplierId', sql.Int, supplierId)
                .query('DELETE FROM SUPPLIERS WHERE SUPPLIER_ID = @supplierId');

            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        res.json({ success: true, message: 'Поставщик удалён' });
    } catch (error) {
        console.error('Ошибка DELETE /api/suppliers/:id:', error);
        res.status(500).json({ success: false, error: error.originalError?.info?.message || error.message || 'Ошибка удаления поставщика' });
    }
});

app.get('/api/stats/summary', async (req, res) => {
    try {
        const db = await getPool();

        const productsRes = await db.request().query(`
            SELECT COUNT(*) AS count
            FROM PRODUCTS
        `);

        const customersRes = await db.request().query(`
            SELECT COUNT(*) AS count
            FROM CUSTOMERS
        `);

        const ordersRes = await db.request().query(`
            SELECT COUNT(*) AS count
            FROM ORDERS
        `);

        const suppliersRes = await db.request().query(`
            SELECT COUNT(*) AS count
            FROM SUPPLIERS
        `);

        const totalOrdersSumRes = await db.request().query(`
            SELECT ISNULL(SUM(oi.SALE_PRICE_AT_TIME * oi.QUANTITY), 0) AS total_sum
            FROM ORDER_ITEMS oi
        `);

        const monthlyRes = await db.request().query(`
            SELECT
                YEAR(o.ORDER_DATE) AS order_year,
                MONTH(o.ORDER_DATE) AS order_month,
                ISNULL(SUM(oi.SALE_PRICE_AT_TIME * oi.QUANTITY), 0) AS total_sum
            FROM ORDERS o
            LEFT JOIN ORDER_ITEMS oi ON oi.ORDER_ID = o.ORDER_ID
            GROUP BY YEAR(o.ORDER_DATE), MONTH(o.ORDER_DATE)
            ORDER BY YEAR(o.ORDER_DATE), MONTH(o.ORDER_DATE)
        `);

        const monthlySales = monthlyRes.recordset.map(item => {
            const month = String(item.order_month).padStart(2, '0');
            return {
                month_key: `${item.order_year}-${month}`,
                month_label: `${month}.${item.order_year}`,
                total_sum: item.total_sum
            };
        });

        res.json({
            success: true,
            data: {
                products_count: productsRes.recordset[0].count,
                customers_count: customersRes.recordset[0].count,
                orders_count: ordersRes.recordset[0].count,
                suppliers_count: suppliersRes.recordset[0].count,
                total_orders_sum: totalOrdersSumRes.recordset[0].total_sum,
                monthly_sales: monthlySales
            }
        });
    } catch (error) {
        console.error('Ошибка /api/stats/summary:', error);
        res.status(500).json({
            success: false,
            error: error.originalError?.info?.message || error.message || 'Ошибка загрузки статистики'
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

app.listen(PORT, async () => {
    try {
        await getPool();
        console.log(`Сервер запущен: http://localhost:${PORT}`);
    } catch (error) {
        console.error('Не удалось подключиться к SQL Server:', error.message);
        console.log(`Сервер запущен без подключения к БД на http://localhost:${PORT}`);
    }
});