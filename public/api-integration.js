// API интеграция для интернет-ресурса продажи медтехники

const NO_IMAGE_SRC =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
      <rect width="100%" height="100%" fill="#f1f5f9"/>
      <text x="50%" y="48%" text-anchor="middle" fill="#64748b" font-size="24" font-family="Arial">
        Нет изображения
      </text>
      <text x="50%" y="60%" text-anchor="middle" fill="#94a3b8" font-size="16" font-family="Arial">
        VitaEquip
      </text>
    </svg>
  `);

class MedicalEquipmentAPI {
  constructor(baseURL = window.location.origin) {
    this.baseURL = baseURL;
    this.apiURL = `${baseURL}/api`;
  }

  async getCategories() {
    try {
      const response = await fetch(`${this.apiURL}/categories`);
      const data = await response.json();
      return data.success ? data.data : [];
    } catch (error) {
      console.error('Ошибка при получении категорий:', error);
      return [];
    }
  }

  async getProducts(page = 1, limit = 50, categoryId = null) {
    try {
      let url = `${this.apiURL}/products?page=${page}&limit=${limit}`;

      if (categoryId) {
        url += `&category_id=${categoryId}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      return data.success
        ? data.data
        : { products: [], total: 0, page: 1, totalPages: 1 };
    } catch (error) {
      console.error('Ошибка при получении продуктов:', error);
      return { products: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  async getProductById(id) {
    try {
      const response = await fetch(`${this.apiURL}/products/${id}`);
      const data = await response.json();
      return data.success ? data.data : null;
    } catch (error) {
      console.error('Ошибка при получении продукта:', error);
      return null;
    }
  }

  async getProductsByCategory(categoryId, page = 1, limit = 50) {
    return this.getProducts(page, limit, categoryId);
  }

  async getAvailablePages() {
    try {
      const response = await fetch(`${this.apiURL}/pages`);
      const data = await response.json();
      return data.success ? data.data : [];
    } catch (error) {
      console.error('Ошибка при получении списка страниц:', error);
      return [];
    }
  }

  async getApiInfo() {
    try {
      const response = await fetch(`${this.apiURL}/info`);
      return await response.json();
    } catch (error) {
      console.error('Ошибка при получении информации об API:', error);
      return null;
    }
  }
}

window.medicalAPI = new MedicalEquipmentAPI();

const CATEGORY_FOLDER_MAP = {
  'УЗИ аппараты': 'ultrasound_devices',
  'Рентгеновские аппараты': 'xray_equipment',
  'МРТ системы': 'mri_equipment',
  'КТ сканеры': 'ct_equipment',
  'ЭКГ аппараты': 'cardiology_equipment',
  'Эндоскопическое оборудование': 'endoscopic_equipment',
  'Лабораторное оборудование': 'laboratory_equipment',
  'Хирургическое оборудование': 'surgical_equipment',
  'Диагностическое оборудование': 'diagnostic_equipment'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getProductPrice(product) {
  return product.price ?? product.CURRENT_SALE_PRICE ?? product.current_sale_price ?? product.sale_price ?? 0;
}

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return 'Цена по запросу';
  }

  return `${number.toLocaleString('ru-RU')} ₽`;
}

function formatWeight(value) {
  if (!value) return 'Не указан';
  const text = String(value).trim();
  return /кг$/i.test(text) ? text : `${text} кг`;
}

function productImageSrc(imagePath) {
  if (!imagePath || imagePath === 'null' || imagePath === 'undefined') {
    return NO_IMAGE_SRC;
  }

  const path = String(imagePath).trim();

  if (!path) {
    return NO_IMAGE_SRC;
  }

  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  if (path.startsWith('data:image')) {
    return path;
  }

  if (path.startsWith('/uploads/')) {
    return path;
  }

  if (path.startsWith('uploads/')) {
    return `/${path}`;
  }

  if (path.startsWith('/public/')) {
    return path;
  }

  if (path.startsWith('public/')) {
    return `/${path}`;
  }

  return `/uploads/${path.replace(/^\/+/, '')}`;
}

function imageTag(src, alt, className = '') {
  return `
    <img
      src="${productImageSrc(src)}"
      alt="${escapeHtml(alt || 'Изображение товара')}"
      class="${className}"
      loading="lazy"
      onerror="this.onerror=null; this.src='${NO_IMAGE_SRC}';"
    >
  `;
}

class PageRenderer {
  static _usedImages = new Set();

  static resetUsedImages() {
    PageRenderer._usedImages = new Set();
  }

  static async getUploadsList() {
    try {
      const res = await fetch('/api/uploads');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  static findBestImage(product, uploadsList, categories) {
    if (!uploadsList || uploadsList.length === 0) return null;

    let categoryFolder = '';

    if (categories && product.category_id) {
      const cat = categories.find(c => Number(c.id) === Number(product.category_id));

      if (cat && CATEGORY_FOLDER_MAP[cat.name]) {
        categoryFolder = CATEGORY_FOLDER_MAP[cat.name];
      }
    }

    if (categoryFolder) {
      const catImages = uploadsList.filter(img =>
        img.startsWith(categoryFolder + '/') &&
        !PageRenderer._usedImages.has(img)
      );

      if (catImages.length > 0) {
        PageRenderer._usedImages.add(catImages[0]);
        return catImages[0];
      }
    }

    const productName = String(product.name || '').toLowerCase();
    const manufacturer = String(product.manufacturer || '').toLowerCase();

    let best = uploadsList.find(img => {
      const lower = img.toLowerCase();

      return !PageRenderer._usedImages.has(img) &&
        (productName && lower.includes(productName) || manufacturer && lower.includes(manufacturer));
    });

    if (best) {
      PageRenderer._usedImages.add(best);
      return best;
    }

    best = uploadsList.find(img => !PageRenderer._usedImages.has(img));

    if (best) {
      PageRenderer._usedImages.add(best);
      return best;
    }

    return null;
  }

  static async renderCategories(containerId = 'categories-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const categories = await window.medicalAPI.getCategories();

    if (!categories || categories.length === 0) {
      container.innerHTML = '<p class="empty-text">Категории не найдены</p>';
      return;
    }

    if (containerId === 'main-categories') {
      const icons = [
        'fa-stethoscope',
        'fa-x-ray',
        'fa-magnet',
        'fa-layer-group',
        'fa-heartbeat',
        'fa-microscope'
      ];

      container.innerHTML = categories.map((category, i) => `
        <div class="main-category-card" data-category-id="${category.id}">
          <span class="main-category-icon fas ${icons[i % icons.length]}"></span>
          <h3>${escapeHtml(category.name)}</h3>
          <p>${escapeHtml(category.description || 'Описание отсутствует')}</p>
          <span class="category-count">Товаров: ${category.product_count || 0}</span>
        </div>
      `).join('');

      container.querySelectorAll('.main-category-card').forEach(card => {
        card.addEventListener('click', function () {
          const categoryId = this.getAttribute('data-category-id');
          window.location.href = `/catalog?category=${categoryId}`;
        });
      });

      return;
    }

    container.innerHTML = categories.map(category => `
      <div class="category-card" data-category-id="${category.id}">
        <h3>${escapeHtml(category.name)}</h3>
        <p>${escapeHtml(category.description || 'Описание отсутствует')}</p>
        <span class="category-count">Товаров: ${category.product_count || 0}</span>
      </div>
    `).join('');

    container.querySelectorAll('.category-card').forEach(card => {
      card.addEventListener('click', function () {
        const categoryId = this.getAttribute('data-category-id');
        PageRenderer.loadProductsByCategory(categoryId);
      });
    });
  }

  static async renderProducts(products, containerId = 'products-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!products || products.length === 0) {
      container.innerHTML = '<p class="empty-text">Товары не найдены</p>';
      return;
    }

    const uploadsList = await PageRenderer.getUploadsList();
    const categories = await window.medicalAPI.getCategories();

    PageRenderer.resetUsedImages();

    container.innerHTML = products.map(product => {
      let img = null;

      if (product.images && product.images.length > 0) {
        img = product.images[0];
      } else if (product.image) {
        img = product.image;
      } else {
        img = PageRenderer.findBestImage(product, uploadsList, categories);
      }

      const price = getProductPrice(product);

      return `
        <div class="product-card" data-product-id="${product.id}">
          <div class="product-image">
            ${imageTag(img, product.name)}
          </div>

          <div class="product-info">
            <h3>${escapeHtml(product.name)}</h3>
            <p class="manufacturer">${escapeHtml(product.manufacturer || 'Производитель не указан')}</p>
            <p class="product-price-fixed">${formatPrice(price)}</p>
            <button class="details-btn" data-id="${product.id}">Подробнее</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.details-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const productId = this.getAttribute('data-id');
        PageRenderer.showProductDetails(productId, uploadsList, categories);
      });
    });
  }

  static async loadProductsByCategory(categoryId) {
    const result = await window.medicalAPI.getProductsByCategory(categoryId, 1, 50);
    const products = result.products || result.data || [];

    await this.renderProducts(products, 'products-container');

    history.pushState({ categoryId }, '', `/catalog?category=${categoryId}`);
  }

  static async showProductDetails(productId, uploadsList = null, categories = null) {
    const product = await window.medicalAPI.getProductById(productId);

    if (!product) {
      alert('Товар не найден');
      return;
    }

    if (!uploadsList) {
      uploadsList = await PageRenderer.getUploadsList();
    }

    if (!categories) {
      categories = await window.medicalAPI.getCategories();
    }

    let images = [];

    if (product.images && product.images.length > 0) {
      images = product.images;
    } else if (product.image) {
      images = [product.image];
    }

    if (images.length === 0) {
      const bestImage = PageRenderer.findBestImage(product, uploadsList, categories);
      if (bestImage) images = [bestImage];
    }

    const modal = document.createElement('div');
    modal.className = 'product-modal';

    modal.innerHTML = `
      <div class="modal-content">
        <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>

        <div class="product-details">
          <div class="product-images">
            ${
              images.length > 0
                ? images.map(img => imageTag(img, product.name)).join('')
                : imageTag(null, product.name)
            }
          </div>

          <div class="product-info-modal">
            <h2>${escapeHtml(product.name)}</h2>
            <p><strong>Производитель:</strong> ${escapeHtml(product.manufacturer || 'Не указан')}</p>
            <p><strong>Категория:</strong> ${escapeHtml(product.category_name || 'Не указана')}</p>
            <p><strong>Тип исполнения:</strong> ${escapeHtml(product.execution_type || 'Не указан')}</p>
            <p><strong>Класс системы:</strong> ${escapeHtml(product.system_class || 'Не указан')}</p>
            <p><strong>Размер монитора:</strong> ${escapeHtml(product.monitor_size || 'Не указан')}</p>
            <p><strong>Активные порты:</strong> ${escapeHtml(product.active_ports || 'Не указаны')}</p>
            <p><strong>Вес:</strong> ${escapeHtml(formatWeight(product.weight))}</p>
            <p><strong>Цена:</strong> ${formatPrice(getProductPrice(product))}</p>
            <p><strong>Описание:</strong> ${escapeHtml(product.description || 'Описание отсутствует')}</p>
          </div>
        </div>
      </div>
    `;

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.remove();
      }
    });

    document.body.appendChild(modal);
  }

  static async initCatalogPage() {
    await this.renderCategories();

    const urlParams = new URLSearchParams(window.location.search);
    const categoryId = urlParams.get('category');

    if (categoryId) {
      await this.loadProductsByCategory(categoryId);
      return;
    }

    const result = await window.medicalAPI.getProducts(1, 50);
    const products = result.products || result.data || [];

    await this.renderProducts(products, 'products-container');
  }

  static async initMainPage() {
    const result = await window.medicalAPI.getProducts(1, 6);
    const products = result.products || result.data || [];

    await this.renderProducts(products, 'featured-products');
    await this.renderCategories('main-categories');
    await this.renderAdvantages('main-advantages');
  }

  static async renderAdvantages(containerId = 'main-advantages') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const advantages = [
      {
        icon: 'fa-certificate',
        title: 'Качество',
        text: 'В каталоге представлены товары для диагностики, лабораторной и хирургической деятельности.'
      },
      {
        icon: 'fa-shipping-fast',
        title: 'Удобная работа с заказами',
        text: 'Система позволяет оформлять заказы, изменять их статусы и контролировать состав заказа.'
      },
      {
        icon: 'fa-database',
        title: 'Централизованная база данных',
        text: 'Информация о товарах, клиентах, поставщиках и оплатах хранится в единой структуре данных.'
      },
      {
        icon: 'fa-user-cog',
        title: 'Административная панель',
        text: 'Для сотрудников предусмотрены инструменты управления товарами, клиентами, заказами и поставщиками.'
      }
    ];

    container.innerHTML = advantages.map(adv => `
      <div class="advantage-card">
        <span class="advantage-icon fas ${adv.icon}"></span>
        <h3>${adv.title}</h3>
        <p>${adv.text}</p>
      </div>
    `).join('');
  }
}

const customCardStyles = `
  <style id="custom-card-styles">
    .empty-text {
      text-align: center;
      color: #64748b;
      padding: 24px;
      font-size: 16px;
    }

    .product-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 18px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      padding: 18px;
      margin: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: 0.25s;
      min-width: 260px;
      max-width: 320px;
      min-height: 430px;
    }

    .product-card:hover {
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16);
      transform: translateY(-5px);
    }

    .product-image {
      width: 100%;
      height: 205px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      margin-bottom: 14px;
      background: #f8fafc;
      border-radius: 14px;
    }

    .product-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 14px;
    }

    .product-info {
      width: 100%;
      text-align: center;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
    }

    .product-info h3 {
      margin: 10px 0 8px 0;
      font-size: 18px;
      line-height: 1.35;
      color: #0066cc;
      min-height: 48px;
    }

    .manufacturer {
      color: #64748b;
      font-size: 14px;
      margin-bottom: 8px;
    }

    .product-price-fixed {
      color: #111827 !important;
      font-weight: 800 !important;
      font-size: 22px !important;
      margin: 12px 0 14px 0 !important;
      display: block !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    .details-btn {
      background: #007bff;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 14px;
      cursor: pointer;
      margin-top: 8px;
      transition: 0.2s;
    }

    .details-btn:hover {
      background: #0056b3;
      transform: translateY(-1px);
    }

    .product-modal {
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(15, 23, 42, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-content {
      background: #ffffff;
      border-radius: 18px;
      padding: 32px 28px;
      max-width: 850px;
      width: 95vw;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
    }

    .close {
      position: absolute;
      right: 18px;
      top: 10px;
      font-size: 30px;
      font-weight: bold;
      color: #64748b;
      cursor: pointer;
      transition: 0.2s;
    }

    .close:hover {
      color: #007bff;
    }

    .product-details {
      display: flex;
      flex-wrap: wrap;
      gap: 28px;
    }

    .product-images {
      flex: 1 1 260px;
      min-width: 220px;
      max-width: 320px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
    }

    .product-images img {
      width: 100%;
      max-height: 330px;
      object-fit: contain;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #e5e7eb;
    }

    .product-info-modal {
      flex: 2 1 360px;
      min-width: 260px;
    }

    .product-info-modal h2 {
      margin-top: 0;
      color: #007bff;
    }

    .product-info-modal p {
      margin: 9px 0;
      color: #334155;
      line-height: 1.4;
    }

    .product-info-modal strong {
      color: #111827;
    }

    .main-category-card,
    .advantage-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
      padding: 24px 20px;
      margin: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      transition: 0.2s;
      min-width: 220px;
      max-width: 320px;
    }

    .main-category-card {
      cursor: pointer;
    }

    .main-category-card:hover,
    .advantage-card:hover {
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
      transform: translateY(-4px);
      border-color: #007bff;
    }

    .main-category-icon,
    .advantage-icon {
      font-size: 34px;
      color: #007bff;
      margin-bottom: 14px;
      display: block;
    }

    .main-category-card h3,
    .advantage-card h3 {
      color: #007bff;
      margin: 8px 0;
    }

    .main-category-card p,
    .advantage-card p {
      color: #475569;
      font-size: 14px;
      line-height: 1.4;
    }

    .category-count {
      margin-top: 8px;
      font-size: 13px;
      color: #64748b;
    }
  </style>
`;

if (!document.getElementById('custom-card-styles')) {
  document.head.insertAdjacentHTML('beforeend', customCardStyles);
}

document.addEventListener('DOMContentLoaded', function () {
  const currentPage = window.location.pathname;

  if (currentPage === '/' || currentPage === '/index.html') {
    PageRenderer.initMainPage();
  }

  if (currentPage === '/catalog') {
    PageRenderer.initCatalogPage();
  }

  console.log('API интеграция загружена');
});