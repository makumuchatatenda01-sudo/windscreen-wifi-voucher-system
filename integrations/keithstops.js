const axios = require('axios');
const fs = require('fs');
const path = require('path');


function saveDebugFile(name, data) {
  try {
    const dir = '/opt/auto-glass-bot/debug';
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch (_) {}
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('KTPOS_DEBUG_SAVE_ERROR:', e.message);
  }
}

function cleanBaseUrl(v) {
  return String(v || '').replace(/\/$/, '');
}

function enabled() {
  return String(process.env.KEITHSTOPS_ENABLED || 'true').toLowerCase() === 'true';
}

function mode() {
  return String(process.env.KEITHSTOPS_MODE || 'mock').toLowerCase();
}

function authHeaders() {
  const key = process.env.KEITHSTOPS_API_KEY || '';
  const authType = String(process.env.KEITHSTOPS_AUTH_TYPE || 'bearer').toLowerCase();

  if (!key) return {};

  if (authType === 'api-key' || authType === 'x-api-key') return { 'X-API-Key': key };
  if (authType === 'token') return { Authorization: `Token ${key}` };

  return {
    Authorization: `Bearer ${key}`,
    Token: `Bearer ${key}`
  };
}

function endpointUrl(path) {
  const baseUrl = cleanBaseUrl(process.env.KEITHSTOPS_API_BASE_URL || 'https://keithtechapi.backofficewebportal.com/v1.0');
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}

function harareParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Harare',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function nowDate() {
  const p = harareParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function nowDateTime() {
  const p = harareParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function splitName(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return { firstName: 'WhatsApp', lastName: 'Customer' };

  const parts = name.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Customer' };

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function cleanPhone(v) {
  return String(v || '').replace(/[^\d+]/g, '');
}

function safeCustomerCode(v, fallback = '') {
  const raw = String(v || fallback || '').trim();
  const cleaned = raw
    .replace(/^\+/, '')
    .replace(/[^A-Za-z0-9._]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  return cleaned || `VP_${Date.now()}`;
}

function money(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function clip(v, max = 6000) {
  const s = String(v || '');
  return s.length > max ? s.slice(0, max - 20) + '...' : s;
}

function buildClaimComment(pack) {
  const d = pack.claimData || {};
  const docs = Array.isArray(pack.attachments) ? pack.attachments : [];

  const docLines = docs
    .map((a, i) => {
      const label = a.caption || a.type || `Document ${i + 1}`;
      const link = a.url || a.mediaId || '';
      return `${i + 1}. ${label}: ${link}`;
    })
    .filter(Boolean)
    .join('\n');

  return clip(
`WhatsApp Insurance Claim Pack

Claim No: ${pack.claimNo || ''}
Job No: ${pack.jobNo || ''}
Insurer: ${pack.insurer || ''}
Customer: ${pack.customerName || ''}
Phone: ${pack.customerPhone || ''}
Vehicle: ${pack.vehicle || d.vehicleMakeModelYear || ''}
Registration: ${pack.registration || d.reg || ''}
Service: ${pack.service || 'Motor glass claim'}

PDF Claim Form:
${pack.pdfUrl || ''}

Important Claim Details:
Policy No: ${d.policyNo || ''}
Claim No: ${d.claimReference || ''}
Driver: ${d.driverName || ''}
Licence No: ${d.licenceNo || ''}
Damage Date/Time: ${d.damageDateTime || ''}
Damage Place: ${d.damagePlace || ''}
Cause of Breakage: ${d.causeOfBreakage || ''}
Other Damage: ${d.otherDamage || ''}
Glass Type: ${d.glassType || ''}
Vehicle Can Be Seen At: ${d.vehicleSeenAt || ''}
Replacement Instructions: ${d.replacementInstructions || ''}
Estimated Cost: ${d.estimatedCost || ''}

Documents / Images:
${docLines || 'Documents are stored in WhatsApp bot system.'}

Source: Vision Pixels WhatsApp Bot`,
    6000
  );
}

// VP_KTPOS_OPTIONAL_EMAIL_V1
function normaliseKeithTechEmail(value) {
  const email =
    String(value || '').trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : '';
}

// VP_KTPOS_REQUIRED_ORDER_EMAIL_V1
function buildKeithTechOrderEmail(
  pack,
  claimData = {}
) {
  const suppliedEmail =
    normaliseKeithTechEmail(
      claimData.email
    );

  if (suppliedEmail) {
    return suppliedEmail;
  }

  const identity =
    String(
      pack.customerPhone ||
      claimData.cellPhone ||
      claimData.phone ||
      pack.claimNo ||
      'customer'
    )
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 40) ||
    'customer';

  return (
    `noemail-${identity}` +
    '@visionpixels.autos'
  );
}

async function createOrUpdateCustomer(pack) {
  const { firstName, lastName } = splitName(pack.customerName);
  const d = pack.claimData || {};
  const customerEmail =
    normaliseKeithTechEmail(d.email);

  const payload = {
    first_name: firstName,
    last_name: lastName,
    ...(customerEmail
      ? { email: customerEmail }
      : {}),
    phone_number: cleanPhone(pack.customerPhone || d.cellPhone || d.phone),
    address: d.address || pack.location || '',
    city: d.city || '',
    region: d.region || '',
    customer_code: safeCustomerCode(cleanPhone(pack.customerPhone || d.cellPhone || d.phone), pack.claimNo),
    customer_note: `Created/updated from WhatsApp claim ${pack.claimNo || ''}`,
    billing_name: pack.customerName || `${firstName} ${lastName}`
  };

  try {
    const res = await axios.post(endpointUrl('/customers'), payload, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      timeout: 30000
    });

    const body = res.data || {};
    return {
      success: true,
      customerId: body.customer_id || body.id || body.customer?.id || body.success?.customer_id || '',
      raw: body
    };
  } catch (err) {
    return {
      success: false,
      customerId: '',
      error: err.response?.data?.message || err.response?.data?.error || err.message,
      raw: err.response?.data || null
    };
  }
}


// VP_EXTERNAL_KTPOS_PAYLOAD_V2
const VP_EXTERNAL_PAYMENT_MAP_PATH =
  '/opt/auto-glass-bot/config/ktpos-payment-map.json';

function loadExternalPaymentMap() {
  try {
    const payload = JSON.parse(
      fs.readFileSync(
        VP_EXTERNAL_PAYMENT_MAP_PATH,
        'utf8'
      )
    );

    return payload && typeof payload === 'object'
      ? payload
      : {};
  } catch {
    return {};
  }
}

function resolveExternalPaymentType(value) {
  const canonical =
    String(value || '').trim();

  const mapping =
    loadExternalPaymentMap();

  return mapping[canonical] || canonical;
}

function previewOrderPayload(pack) {
  return buildOnlineOrderPayload(
    pack,
    {
      success: false,
      customerId: ''
    }
  );
}

async function fetchReferenceDataPath(paths) {
  let lastError;

  for (const pathname of paths) {
    try {
      const response = await axios.get(
        endpointUrl(pathname),
        {
          headers: {
            ...authHeaders()
          },
          timeout: 30000
        }
      );

      return response.data || {};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ||
    new Error(
      'Keith Tech reference-data request failed.'
    );
}

async function getReferenceData() {
  const productCode =
    process.env.KTPOS_DEFAULT_PRODUCT_CODE ||
    '10002';

  const paymentTypes =
    await fetchReferenceDataPath([
      '/payment_types?limit=100',
      '/payment_types'
    ]);

  const products =
    await fetchReferenceDataPath([
      `/products?product_codes=${encodeURIComponent(productCode)}&limit=100`,
      `/products?limit=100&product_codes=${encodeURIComponent(productCode)}`,
      '/products?limit=100'
    ]);

  return {
    paymentTypes,
    products,
    requestedProductCode: productCode
  };
}


// VP_KTPOS_FULL_CATALOGUE_V2
// Keith Tech legacy read endpoints accept filters and cursors in a JSON body
// on GET requests. The .php endpoints expose the complete catalogue.
function keithReadHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent':
      'VisionCo-Auto-Glass-Catalogue/2.0',
    ...authHeaders()
  };
}

async function keithLegacyGet(
  pathValue,
  payload = {},
  timeout = 60000
) {
  return axios.get(
    endpointUrl(pathValue),
    {
      headers: keithReadHeaders(),
      data: payload,
      timeout
    }
  );
}

async function paginateKeithLegacy({
  pathValue,
  rootKey,
  payload = {},
  limit = 100,
  maxPages = 100,
  keyOf
}) {
  const rowsByKey = new Map();
  const pages = [];
  const seenCursors = new Set();
  let cursor = '';
  let stopReason = 'max_pages';

  for (
    let page = 1;
    page <= maxPages;
    page += 1
  ) {
    const body = {
      ...payload,
      limit,
      ...(cursor ? { cursor } : {})
    };

    const response = await keithLegacyGet(
      pathValue,
      body
    );

    const rows = Array.isArray(
      response.data?.[rootKey]
    )
      ? response.data[rootKey]
      : [];

    const countBefore = rowsByKey.size;

    rows.forEach((row, index) => {
      const rowKey = String(
        typeof keyOf === 'function'
          ? keyOf(row, index)
          : (
              row?.product_code ||
              row?.id ||
              row?.product_id ||
              JSON.stringify(row)
            )
      );

      if (!rowsByKey.has(rowKey)) {
        rowsByKey.set(rowKey, row);
      }
    });

    const added =
      rowsByKey.size - countBefore;

    const nextCursor = String(
      response.data?.cursor || ''
    );

    pages.push({
      page,
      count: rows.length,
      added,
      cursor: nextCursor,
      totalUnique: rowsByKey.size
    });

    if (!nextCursor) {
      stopReason = 'no_cursor';
      break;
    }

    if (rows.length === 0) {
      stopReason = 'empty_page';
      break;
    }

    if (seenCursors.has(nextCursor)) {
      stopReason = 'repeated_cursor';
      break;
    }

    if (page > 1 && added === 0) {
      stopReason = 'no_new_rows';
      break;
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    rows: Array.from(rowsByKey.values()),
    pages,
    stopReason
  };
}

function normaliseCatalogueProduct(
  product,
  inventory,
  shopId
) {
  const shops = Array.isArray(product?.shops)
    ? product.shops
    : [];

  const shop =
    shops.find(item =>
      String(
        item?.shop_id || item?.id || ''
      ).trim() === shopId
    ) ||
    shops[0] ||
    null;

  const productCode = String(
    product?.product_code ||
    inventory?.product_code ||
    ''
  ).trim();

  const productId = String(
    product?.id ||
    inventory?.product_id ||
    ''
  ).trim();

  const productName = String(
    product?.product_name || ''
  ).trim();

  const metadataComplete = Boolean(
    productId &&
    productCode &&
    productName &&
    product?.id
  );

  return {
    productId,
    productCode,
    productName,
    category: String(
      product?.category || ''
    ),
    subCategory: String(
      product?.sub_category || ''
    ),
    cost: Number(product?.cost || 0),
    price:
      shop &&
      shop.price !== null &&
      shop.price !== undefined
        ? Number(shop.price || 0)
        : null,
    inStock:
      inventory &&
      inventory.in_stock !== null &&
      inventory.in_stock !== undefined
        ? Number(inventory.in_stock || 0)
        : null,
    stockControl: Boolean(
      product?.stock_control
    ),
    availableForSale:
      shop
        ? shop.available_for_sale !== false
        : null,
    safetyStock:
      shop &&
      shop.safety_stock !== null &&
      shop.safety_stock !== undefined
        ? Number(shop.safety_stock || 0)
        : null,
    barcode: String(
      product?.barcode || ''
    ),
    measurement: String(
      product?.measurement || ''
    ),
    createdDate: String(
      product?.created_date || ''
    ),
    updatedDate: String(
      product?.updated_date || ''
    ),
    metadataComplete,
    source: metadataComplete
      ? 'keith_products_php'
      : 'keith_inventory_only'
  };
}

async function fetchFullProductCatalogue() {
  const shopId = String(
    process.env.KTPOS_SHOP_ID || ''
  ).trim();

  if (!shopId) {
    throw new Error(
      'Keith Tech shop ID is not configured.'
    );
  }

  const [productResult, inventoryResult] =
    await Promise.all([
      paginateKeithLegacy({
        pathValue: '/products.php',
        rootKey: 'products',
        payload: {},
        limit: 100,
        maxPages: 100,
        keyOf: row =>
          String(
            row?.product_code ||
            row?.id || ''
          )
      }),
      paginateKeithLegacy({
        pathValue: '/inventory.php',
        rootKey: 'inventory_levels',
        payload: {
          shop_ids: shopId
        },
        limit: 250,
        maxPages: 100,
        keyOf: row =>
          String(
            row?.product_code ||
            row?.product_id || ''
          )
      })
    ]);

  const productByCode = new Map(
    productResult.rows.map(product => [
      String(
        product?.product_code || ''
      ).trim(),
      product
    ])
  );

  const inventoryByCode = new Map(
    inventoryResult.rows.map(inventory => [
      String(
        inventory?.product_code || ''
      ).trim(),
      inventory
    ])
  );

  const codes = Array.from(
    new Set([
      ...productByCode.keys(),
      ...inventoryByCode.keys()
    ])
  )
    .filter(Boolean)
    .sort((left, right) =>
      left.localeCompare(right)
    );

  const products = codes.map(code =>
    normaliseCatalogueProduct(
      productByCode.get(code) || null,
      inventoryByCode.get(code) || null,
      shopId
    )
  );

  return {
    products,
    stats: {
      productCount:
        productResult.rows.length,
      inventoryCount:
        inventoryResult.rows.length,
      mergedCount: products.length,
      completeCount:
        products.filter(
          product => product.metadataComplete
        ).length,
      incompleteCount:
        products.filter(
          product => !product.metadataComplete
        ).length,
      productPages: productResult.pages,
      inventoryPages: inventoryResult.pages,
      productStopReason:
        productResult.stopReason,
      inventoryStopReason:
        inventoryResult.stopReason,
      fetchedAt:
        new Date().toISOString()
    }
  };
}

async function fetchHistoricalProductEvidence({
  createdAtMin = '2024-01-01 00:00:00',
  createdAtMax = (
    new Date().toISOString().slice(0, 10) +
    ' 23:59:59'
  )
} = {}) {
  const result = await paginateKeithLegacy({
    pathValue: '/receipts.php',
    rootKey: 'receipts',
    payload: {
      created_at_min: createdAtMin,
      created_at_max: createdAtMax
    },
    limit: 5000,
    maxPages: 20,
    keyOf: receipt => [
      receipt?.shop_id || '',
      receipt?.pos_device_id || '',
      receipt?.receipt_number || ''
    ].join('|')
  });

  const productsByCode = new Map();

  result.rows.forEach(receipt => {
    const receiptDate = String(
      receipt?.receipt_date_time ||
      receipt?.receipt_date || ''
    );

    const lineProducts = Array.isArray(
      receipt?.line_products
    )
      ? receipt.line_products
      : [];

    lineProducts.forEach(product => {
      const productCode = String(
        product?.product_code || ''
      ).trim();

      if (!productCode) return;

      const current =
        productsByCode.get(productCode);

      if (
        !current ||
        receiptDate >= current.lastReceiptDate
      ) {
        productsByCode.set(productCode, {
          productId: String(
            product?.product_id || ''
          ),
          productCode,
          productName: String(
            product?.product_name || ''
          ),
          category: String(
            product?.category_name || ''
          ),
          cost: Number(product?.cost || 0),
          price: Number(product?.price || 0),
          lastReceiptDate: receiptDate
        });
      }
    });
  });

  return {
    products:
      Array.from(productsByCode.values()),
    stats: {
      receiptCount: result.rows.length,
      uniqueProductCount:
        productsByCode.size,
      pages: result.pages,
      stopReason: result.stopReason,
      fetchedAt:
        new Date().toISOString()
    }
  };
}

// Read-only exact product verification against the complete catalogue.
async function lookupProductByCode(value) {
  const requestedCode =
    String(value || '').trim();

  if (!requestedCode) {
    return {
      success: false,
      status: 'invalid_code',
      requestedCode: '',
      message:
        'A glass or product code is required.'
    };
  }

  try {
    const catalogue =
      await fetchFullProductCatalogue();

    const product =
      catalogue.products.find(item =>
        String(item.productCode || '')
          .toUpperCase() ===
        requestedCode.toUpperCase()
      ) || null;

    if (!product) {
      return {
        success: false,
        status: 'not_found',
        requestedCode,
        message:
          'No exact Keith Tech product match was found. Submission remains blocked.'
      };
    }

    if (!product.metadataComplete) {
      return {
        success: false,
        status: 'product_creation_required',
        requestedCode,
        productId: product.productId,
        productCode: product.productCode,
        productName: product.productName,
        inStock: product.inStock,
        message:
          'This code exists in inventory but is not an active complete Keith Tech product. Create or restore the product before submission.'
      };
    }

    return {
      success: true,
      status: 'verified',
      requestedCode,
      ...product,
      checkedAt:
        new Date().toISOString(),
      message:
        'Exact Keith Tech product match verified from the complete catalogue.'
    };
  } catch (error) {
    return {
      success: false,
      status: 'lookup_error',
      requestedCode,
      httpStatus:
        error.response?.status || null,
      message: String(
        error.response?.data?.errors?.details ||
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        'Keith Tech product lookup failed.'
      ).slice(0, 500)
    };
  }
}

function buildOnlineOrderPayload(pack, customerResult) {
  const {
    firstName,
    lastName
  } = splitName(pack.customerName);

  const d = pack.claimData || {};
  const customerEmail =
    buildKeithTechOrderEmail(
      pack,
      d
    );

  const productCode = String(
    pack.productCode ||
    process.env.KTPOS_DEFAULT_PRODUCT_CODE ||
    '10002'
  ).trim();

  const productName = String(
    pack.productName ||
    process.env.KTPOS_DEFAULT_PRODUCT_NAME ||
    'Shortfall'
  ).trim();

  const suppliedAmount =
    pack.amount !== undefined &&
    pack.amount !== null &&
    String(pack.amount).trim() !== ''
      ? pack.amount
      : process.env.KTPOS_DEFAULT_PRODUCT_PRICE || 0;

  const price = money(suppliedAmount);

  const suppliedQuantity =
    Number(pack.productQuantity || 1);

  const quantity =
    Number.isFinite(suppliedQuantity) &&
    suppliedQuantity > 0
      ? suppliedQuantity
      : 1;

  const productCost =
    money(pack.productCost || 0);

  const orderTotal =
    money(price * quantity);

  const canonicalPayment =
    String(pack.paymentType || '').trim();

  const paymentType =
    resolveExternalPaymentType(
      canonicalPayment
    );

  const paymentReference = clip(
    String(
      pack.paymentReference || ''
    ).trim(),
    180
  );

  const baseComment = String(
    pack.orderComment ||
    buildClaimComment(pack) ||
    ''
  ).trim();

  const comment = clip(
    [
      baseComment,
      pack.currency
        ? `Currency: ${pack.currency}`
        : '',
      canonicalPayment
        ? `Payment: ${canonicalPayment}`
        : ''
    ]
      .filter(Boolean)
      .join(' | '),
    1000
  );

  const orderPayments =
    orderTotal > 0 &&
    paymentType &&
    canonicalPayment !== 'Review Required'
      ? [
          {
            payment_type: paymentType,
            payment_amount: orderTotal,
            payment_reference:
              paymentReference,
            is_advance: 0
          }
        ]
      : [];

  return {
    order_date: nowDate(),
    order_reference_number:
      pack.claimNo || `VP-${Date.now()}`,
    order_reference_id:
      pack.claimNo || `VP-${Date.now()}`,
    order_total: orderTotal,
    channel_order_status_id: 0,
    channel_order_status_name: 'Pending',
    order_comment: comment,
    table_code: '',
    order_type:
      pack.orderType ||
      process.env.KTPOS_DEFAULT_ORDER_TYPE ||
      '',
    target_terminal:
      process.env.KTPOS_TARGET_TERMINAL || '',
    // VP_KTPOS_ORDER_CUSTOMER_ID_V1
    ...(String(
      customerResult?.customerId || ''
    ).trim()
      ? {
          customer_id: String(
            customerResult.customerId
          ).trim()
        }
      : {}),
    customer_first_name: firstName,
    customer_last_name: lastName,
    customer_phone:
      cleanPhone(
        pack.customerPhone ||
        d.cellPhone ||
        d.phone
      ),
    customer_email:
      customerEmail,
    order_date_time: nowDateTime(),
    shop_id:
      process.env.KTPOS_SHOP_ID || '',
    order_items: [
      {
        product_code: productCode,
        product_name: productName,
        product_qty: quantity,
        product_unit_price: price,
        product_price: price,
        product_cost: productCost,
        product_remark:
          clip(comment, 250),
        product_modifiers: [],
        product_taxes: [],
        product_discounts: []
      }
    ],
    order_total_discounts: [],
    fixed_charges: [],
    order_payments: orderPayments
  };
}

// VP_KTPOS_DUPLICATE_SAFE_CUSTOMER_V1
async function resolveCustomerForSubmission(pack) {
  const existingCustomerId =
    String(
      pack.existingCustomerId || ''
    ).trim();

  if (existingCustomerId) {
    return {
      success: true,
      customerId: existingCustomerId,
      reused: true,
      raw: null
    };
  }

  const customerResult =
    await createOrUpdateCustomer(pack);

  const customerId =
    String(
      customerResult.customerId || ''
    ).trim();

  if (
    customerResult.success &&
    customerId &&
    typeof pack.onCustomerResolved ===
      'function'
  ) {
    await pack.onCustomerResolved({
      customerId,
      createdAt:
        new Date().toISOString(),
      reused: false
    });
  }

  return {
    ...customerResult,
    customerId,
    reused: false
  };
}

async function submitClaimPack(pack) {
  if (!enabled()) {
    return {
      success: false,
      status: 'disabled',
      reference: '',
      message: 'KEITH TECH POS integration disabled.'
    };
  }

  if (mode() === 'mock') {
    return {
      success: true,
      status: 'submitted_mock',
      reference: `KT-DEMO-${Date.now()}`,
      message: 'Mock KEITH TECH POS submission successful.'
    };
  }

  const customerResult =
    await resolveCustomerForSubmission(pack);
  const payload = buildOnlineOrderPayload(pack, customerResult);

  saveDebugFile('ktpos-last-online-order-payload.json', {
    createdAt: new Date().toISOString(),
    claimNo: pack.claimNo,
    customerResult,
    payload
  });

  try {
    const res = await axios.post(endpointUrl(process.env.KEITHSTOPS_SUBMIT_CLAIM_ENDPOINT || '/online_orders'), payload, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      timeout: 45000
    });

    const body = res.data || {};

    const reference =
      body.success?.system_unique_id ||
      body.success?.order_reference_id ||
      body.success?.order_reference_number ||
      body.success?.order_number ||
      body.system_unique_id ||
      body.order_reference_id ||
      body.order_reference_number ||
      body.order_number ||
      body.order_id ||
      body.id ||
      payload.order_reference_id ||
      pack.claimNo ||
      '';

    const status =
      body.success?.code === 'SUCCESS'
        ? 'submitted_to_keith_tech_pos'
        : (body.status || body.message || body.order_status || 'submitted_to_keith_tech_pos');

    saveDebugFile('ktpos-last-online-order-success.json', {
      createdAt: new Date().toISOString(),
      claimNo: pack.claimNo,
      reference,
      status,
      response: body,
      payload
    });

    try {
      fs.unlinkSync('/opt/auto-glass-bot/debug/ktpos-last-online-order-error.json');
    } catch (e) {}

    return {
      success: true,
      status,
      reference,
      message: `KEITH TECH POS online order submitted.${customerResult.success ? '' : ` Customer sync warning: ${customerResult.error}`}`,
      raw: body,
      payloadReference: payload.order_reference_id
    };
  } catch (err) {
    const errorData = err.response?.data || null;
    const errorStatus = err.response?.status || null;
    const errorText = typeof errorData === 'string'
      ? errorData
      : JSON.stringify(errorData || {}, null, 2);

    saveDebugFile('ktpos-last-online-order-error.json', {
      createdAt: new Date().toISOString(),
      status: errorStatus,
      error: errorData || err.message,
      responseHeaders: null
    });

    console.error('KTPOS_ONLINE_ORDER_ERROR_STATUS:', errorStatus);
    console.error('KTPOS_ONLINE_ORDER_ERROR_SUMMARY:', clip(
      errorData?.errors?.details || errorData?.message || errorData?.error || err.message || 'Keith Tech request failed.',
      500
    ));
    console.error('KTPOS_ONLINE_ORDER_PAYLOAD_SAVED:', '/opt/auto-glass-bot/debug/ktpos-last-online-order-payload.json');

    const duplicateOrder =
      String(errorText || '').toLowerCase().includes('order reference id already used') ||
      String(errorData?.errors?.details || '').toLowerCase().includes('order reference id already used');

    if (duplicateOrder) {
      saveDebugFile('ktpos-last-online-order-success.json', {
        createdAt: new Date().toISOString(),
        claimNo: pack.claimNo,
        reference: payload.order_reference_id || pack.claimNo,
        status: 'already_submitted_to_keith_tech_pos',
        response: errorData,
        payload
      });

      try {
        fs.unlinkSync('/opt/auto-glass-bot/debug/ktpos-last-online-order-error.json');
      } catch (e) {}

      return {
        success: true,
        status: 'already_submitted_to_keith_tech_pos',
        reference: payload.order_reference_id || pack.claimNo,
        message: 'This claim already exists in KEITH TECH POS. No duplicate order was created.',
        raw: errorData || null,
        payloadReference: payload.order_reference_id
      };
    }

    return {
      success: false,
      status: 'api_error',
      reference: '',
      message: `HTTP ${errorStatus || ''}: ${String(errorText || err.message).slice(0, 1200)}`,
      raw: errorData || null
    };
  }
}

async function getStatus(reference) {
  if (!enabled()) {
    return {
      success: false,
      status: 'disabled',
      message: 'KEITH TECH POS integration disabled.'
    };
  }

  if (mode() === 'mock') {
    return {
      success: true,
      status: 'submitted_mock',
      reference,
      message: 'Mock KEITH TECH POS status.'
    };
  }

  const ref = encodeURIComponent(reference || '');
  const attempts = [
    `/online_order_status?order_reference_ids=${ref}`,
    `/online_order_status?order_reference_id=${ref}`,
    `/online_order_status?order_reference_number=${ref}`,
    `/online_order_status?order_numbers=${ref}`,
    `/online_order_status?limit=10`
  ];

  let lastError = '';

  for (const path of attempts) {
    try {
      const res = await axios.get(endpointUrl(path), {
        headers: {
          ...authHeaders()
        },
        timeout: 30000
      });

      const body = res.data || {};
      return {
        success: true,
        status: body.status || body.order_status?.[0]?.order_status_name || body.order_status?.[0]?.order_status || 'status_fetched',
        reference,
        message: 'KEITH TECH POS status fetched.',
        raw: body
      };
    } catch (err) {
      lastError = err.response?.data?.message || err.response?.data?.error || err.message;
    }
  }

  return {
    success: false,
    status: 'api_error',
    reference,
    message: lastError || 'Could not fetch KEITH TECH POS status.'
  };
}

module.exports = {
  getReferenceData,
  fetchFullProductCatalogue,
  fetchHistoricalProductEvidence,
  lookupProductByCode,
  previewOrderPayload,
  submitClaimPack,
  getStatus
};
