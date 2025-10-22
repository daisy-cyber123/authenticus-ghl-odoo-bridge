require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASS, GHL_API_KEY } = process.env;

// --- Authenticate to Odoo ---
async function odooAuth() {
  const res = await axios.post(`${ODOO_URL}/web/session/authenticate`, {
    jsonrpc: "2.0",
    params: { db: ODOO_DB, login: ODOO_USER, password: ODOO_PASS },
  });
  return res.data.result.session_id;
}

// --- Create or find product ---
async function findOrCreateProduct(session, name, price) {
  const search = await axios.post(`${ODOO_URL}/web/dataset/call_kw`, {
    jsonrpc: "2.0",
    params: {
      model: "product.product",
      method: "search_read",
      args: [[["name", "=", name]]],
      kwargs: { fields: ["id"] },
    },
  }, { headers: { "X-Openerp-Session-Id": session } });

  if (search.data.result.length) return search.data.result[0].id;

  const create = await axios.post(`${ODOO_URL}/web/dataset/call_kw`, {
    jsonrpc: "2.0",
    params: {
      model: "product.product",
      method: "create",
      args: [{ name, list_price: price, type: "service" }],
    },
  }, { headers: { "X-Openerp-Session-Id": session } });

  return create.data.result;
}

// --- Create sales order in Odoo ---
async function createOrder(session, customer, items) {
  const order = await axios.post(`${ODOO_URL}/web/dataset/call_kw`, {
    jsonrpc: "2.0",
    params: {
      model: "sale.order",
      method: "create",
      args: [{
        partner_id: customer,
        order_line: items.map(i => [0, 0, {
          product_id: i.product_id,
          product_uom_qty: i.qty,
          price_unit: i.price,
        }]),
      }],
    },
  }, { headers: { "X-Openerp-Session-Id": session } });

  return order.data.result;
}

// --- Endpoint that GHL calls when quote is accepted ---
app.post("/ghl/order", async (req, res) => {
  const { customer, products } = req.body; // from GHL webhook
  const session = await odooAuth();

  const itemLines = [];
  for (const p of products) {
    const id = await findOrCreateProduct(session, p.name, p.price);
    itemLines.push({ product_id: id, qty: p.qty, price: p.price });
  }

  const orderId = await createOrder(session, customer.odoo_id, itemLines);
  res.json({ status: "ok", orderId });
});

app.listen(3000, () => console.log("Bridge running on port 3000"));
