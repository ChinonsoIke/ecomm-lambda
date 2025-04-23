import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  ScanCommand,
  PutCommand,
  GetCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: "us-east-2" });
const REGION = "us-east-2";
const dynamoDB = new DynamoDBClient({ region: REGION });
const snsClient = new SNSClient({ region: REGION });
const SNS_TOPIC_ARN = "arn:aws:sns:us-east-2:576771098782:email-sub";

let claims = null;

function formatResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "https://cloud.anasroud.com",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    },
    body: JSON.stringify(body)
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return formatResponse(200, {});
  }

  try {
    claims = event.requestContext?.authorizer?.claims;
    const evt = event.body && event.body !== "" ? JSON.parse(event.body) : {};

    const path = event.rawPath || event.path || "";
    const httpMethod = event.httpMethod || "";

    if (path.startsWith("/products/") && httpMethod === "GET" && event.pathParameters?.productId) {
      const productId = event.pathParameters.productId;
      return await getProductById(productId);
    }

    switch (true) {
      case path === "/products":
        return await getProducts(event);

      case path === "/search":
        return await search(evt.searchTerm);

      case path === "/cart" && httpMethod === "POST":
        return await addToCart(evt.productId);

      case path.startsWith("/cart/") && httpMethod === "DELETE":
        const cartItemId = event.pathParameters?.cartItemId;
        return await deleteCartItem(cartItemId);

      case path === "/cart" && httpMethod === "DELETE":
        return await clearCart();

      case path === "/cart":
        return await getCart();

      case path === "/cats":
        return await getCategories();

      case path === "/orders" && httpMethod === "POST":
        return await order(evt.productIds);

      case path === "/orders":
        return await getOrders();

      case path === "/sub" && httpMethod === "POST":
        return await subscribeToSNS(evt.email);

      case path === "/test":
        return formatResponse(200, { data: { testing: "latest version running" }, message: "Test route working" });

      default:
        return formatResponse(404, { data: null, error: "Route not found " + path });
    }
  } catch (error) {
    console.error("Unhandled Error:", error);
    return formatResponse(500, { data: null, error: error.message });
  }
};

async function getProducts(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const {
      title,
      minPrice,
      maxPrice,
      isInStock,
      newest,
      category,
      offset = 0,
      limit = 10,
      orderByPrice
    } = queryParams;

    const command = new ScanCommand({ TableName: "Products" });
    const result = await dynamoDB.send(command);
    let products = result.Items || [];

    // Apply filters
    if (title) {
      products = products.filter(p => p.title?.toLowerCase().includes(title.toLowerCase()));
    }
    if (minPrice) {
      products = products.filter(p => p.price >= Number(minPrice));
    }
    if (maxPrice) {
      products = products.filter(p => p.price <= Number(maxPrice));
    }
    if (isInStock) {
      const inStockBool = isInStock === "true";
      products = products.filter(p => p.isInStock === inStockBool);
    }
    if (category) {
      products = products.filter(p => p.category?.toLowerCase() === category.toLowerCase());
    }

    // Sorting
    if (orderByPrice !== undefined) {
      const sortOrder = Number(orderByPrice);
      products.sort((a, b) => sortOrder === 0 ? a.price - b.price : b.price - a.price);
    }
    if (newest === "true") {
      products.sort((a, b) => b.createdAt - a.createdAt); // Assuming createdAt exists
    }

    // Meta info
    const totalItems = products.length;
    const totalPages = Math.ceil(totalItems / Number(limit));
    const currentPage = Math.floor(Number(offset) / Number(limit)) + 1;

    // Pagination
    const paginated = products.slice(Number(offset), Number(offset) + Number(limit));

    return formatResponse(200, {
      data: paginated,
      meta: {
        totalItems,
        totalPages,
        currentPage
      },
      message: "Products fetched successfully"
    });
  } catch (error) {
    console.error("Error filtering products:", error);
    return formatResponse(500, { data: null, error: "Failed to fetch products" });
  }
}

async function getProductById(productId) {
  try {
    const command = new GetCommand({ TableName: "Products", Key: { id: productId } });
    const result = await dynamoDB.send(command);
    if (!result.Item) {
      return formatResponse(404, { data: null, error: "Product not found" });
    }
    return formatResponse(200, { data: result.Item, message: "Product fetched successfully" });
  } catch (error) {
    console.error("Error fetching product:", error);
    return formatResponse(500, { data: null, error: "Failed to fetch product" });
  }
}

async function search(query = "") {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return formatResponse(400, { data: null, error: "Missing or invalid search term" });
  }
  const normalizedQuery = query.toLowerCase();
  const command = new ScanCommand({ TableName: "Products" });
  try {
    const result = await dynamoDB.send(command);
    const filtered = (result.Items || []).filter(item =>
      item.title?.toLowerCase().includes(normalizedQuery) ||
      item.description?.toLowerCase().includes(normalizedQuery)
    );
    return formatResponse(200, { data: filtered, message: "Search completed successfully" });
  } catch (err) {
    console.error("Search failed:", err);
    return formatResponse(500, { data: null, error: "Search failed" });
  }
}

async function getCart() {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }
  try {
    const getCart = new ScanCommand({
      TableName: "Carts",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": claims.sub }
    });
    const cartResult = await dynamoDB.send(getCart);
    const cart = cartResult.Items?.[0];
    let id = "";
    if (!cart) {
      id = Date.now().toString(36);
      const createCart = new PutCommand({
        TableName: "Carts",
        Item: { id: id, userId: claims.sub }
      });
      await dynamoDB.send(createCart);
    } else id = cart.id;

    const getCartItems = new ScanCommand({
      TableName: "CartItems",
      FilterExpression: "cartId = :cartId",
      ExpressionAttributeValues: { ":cartId": id }
    });
    const cartItemsResult = await dynamoDB.send(getCartItems);
    if (!cartItemsResult.Items || cartItemsResult.Items.length === 0) {
      return formatResponse(200, { data: { id: id, userId: claims.sub, items: [] }, message: "Cart is empty" });
    }
    const itemsWithProducts = await Promise.all(
      cartItemsResult.Items.map(async (item) => {
        const productCommand = new GetCommand({
          TableName: "Products",
          Key: { id: item.productId }
        });
        const productResult = await dynamoDB.send(productCommand);
        return { ...item, product: productResult.Item };
      })
    );
    const response = { id: id, userId: claims.sub, items: itemsWithProducts };
    return formatResponse(200, { data: response, message: "Cart fetched successfully" });
  } catch (err) {
    console.error("Get cart failed:", err);
    return formatResponse(500, { data: null, error: "Get cart failed" });
  }
}

async function addToCart(productId) {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }
  try {
    const getCart = new ScanCommand({
      TableName: "Carts",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": claims.sub }
    });
    const cartResult = await dynamoDB.send(getCart);
    const cart = cartResult.Items?.[0];
    let id = "";
    if (!cart) {
      id = Date.now().toString(36);
      const createCart = new PutCommand({
        TableName: "Carts",
        Item: { id: id, userId: claims.sub }
      });
      await dynamoDB.send(createCart);
    } else id = cart.id;

    const command = new PutCommand({
      TableName: "CartItems",
      Item: { id: Date.now().toString(36), cartId: id, productId: productId }
    });
    await dynamoDB.send(command);
    return formatResponse(200, { data: null, message: "Item added to cart" });
  } catch (err) {
    console.error("Add to cart failed:", err);
    return formatResponse(500, { data: null, error: "Add to cart failed" });
  }
}

async function deleteCartItem(cartItemId) {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }
  try {
    const getCart = new ScanCommand({
      TableName: "Carts",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": claims.sub }
    });
    const cartResult = await dynamoDB.send(getCart);
    const cart = cartResult.Items?.[0];
    if (!cart) {
      return formatResponse(404, { data: null, error: "Cart not found" });
    }
    await dynamoDB.send(new DeleteCommand({
      TableName: "CartItems",
      Key: { id: cartItemId }
    }));
    return formatResponse(200, { data: null, message: `Cart item ${cartItemId} deleted successfully` });
  } catch (err) {
    console.error("Delete cart item failed:", err);
    return formatResponse(500, { data: null, error: "Delete cart item failed", details: err.message });
  }
}

async function clearCart() {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }
  try {
    const getCart = new ScanCommand({
      TableName: "Carts",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": claims.sub }
    });
    const cartResult = await dynamoDB.send(getCart);
    const cart = cartResult.Items?.[0];
    if (!cart) {
      return formatResponse(404, { data: null, error: "Cart not found" });
    }
    const cartId = cart.id;
    const getCartItems = new ScanCommand({
      TableName: "CartItems",
      FilterExpression: "cartId = :cartId",
      ExpressionAttributeValues: { ":cartId": cartId }
    });
    const cartItemsResult = await dynamoDB.send(getCartItems);
    if (cartItemsResult.Items && cartItemsResult.Items.length > 0) {
      await Promise.all(
        cartItemsResult.Items.map((item) =>
          dynamoDB.send(new DeleteCommand({
            TableName: "CartItems",
            Key: { id: item.id }
          }))
        )
      );
    }
    return formatResponse(200, { data: null, message: "All cart items deleted successfully" });
  } catch (err) {
    console.error("Clear cart failed:", err);
    return formatResponse(500, { data: null, error: "Clear cart failed" });
  }
}

async function getCategories() {
  try {
    const command = new ScanCommand({ TableName: "Products", ProjectionExpression: "category" });
    const result = await dynamoDB.send(command);
    const categories = Array.from(
      new Set((result.Items || []).map(item => item.category).filter(Boolean))
    );

    return formatResponse(200, { data: categories, message: "Categories fetched successfully" });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return formatResponse(500, { data: null, error: "Failed to fetch categories" });
  }
}

async function getOrders() {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }

  try {
    const getOrders = new ScanCommand({
      TableName: "Orders",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": claims.sub }
    });
    const getOrdersResult = await dynamoDB.send(getOrders);
    const orders = getOrdersResult.Items || [];

    // For each order, fetch product details
    const ordersWithProducts = await Promise.all(
      orders.map(async (order) => {
        const products = await Promise.all(
          order.productIds.map(async (productId) => {
            const getProduct = new GetCommand({
              TableName: "Products",
              Key: { id: productId }
            });
            const productResult = await dynamoDB.send(getProduct);
            return productResult.Item || null;
          })
        );

        return {
          ...order,
          products: products.filter(Boolean) // Remove nulls if product not found
        };
      })
    );

    const response = { userId: claims.sub, orders: ordersWithProducts };
    return formatResponse(200, { data: response, message: "Orders fetched successfully" });
  } catch (err) {
    console.error("Get orders failed:", err);
    return formatResponse(500, { data: null, error: "Get orders failed" });
  }
}

async function order(productIds) {
  if (!claims) {
    return formatResponse(401, { data: null, error: "Unauthorized" });
  }

  const orderItem = {
    id: Date.now().toString(36),
    userId: claims.sub,
    productIds: productIds,
    orderedAt: new Date().toISOString(),
  };

  const command = new PutCommand({
    TableName: "Orders",
    Item: orderItem,
  });

  try {
    await dynamoDB.send(command);

    // Send SES email
    const userEmail = claims.email; // From Cognito claims
    if (userEmail) {
      await sendOrderConfirmationEmail(orderItem, userEmail);
    }

    return formatResponse(200, { data: orderItem, message: "Order placed successfully" });
  } catch (err) {
    console.error("Order failed:", err);
    return formatResponse(500, { data: null, error: "Order failed" });
  }
}

async function sendOrderConfirmationEmail(orderItem, userEmail) {
  const htmlBody = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
          <div style="text-align: center;">
            <img src="https://yourdomain.com/logo.png" alt="Company Logo" style="max-height: 60px;"/>
          </div>
          <h2 style="color: #4CAF50; text-align: center;">Order Confirmation</h2>
          <p>Hi there,</p>
          <p>Thank you for your purchase! Here are your order details:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">Order ID:</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${orderItem.id}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">Ordered At:</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${orderItem.orderedAt}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">Products:</td>
              <td style="padding: 8px; border: 1px solid #ddd;">
                ${orderItem.productIds.map(pid => `<div>${pid}</div>`).join("")}
              </td>
            </tr>
          </table>
          <p style="margin-top: 20px;">If you have any questions, feel free to contact our support team.</p>
          <p style="text-align: center; color: #999;">&copy; ${new Date().getFullYear()} Your Company Name</p>
        </div>
      </body>
    </html>
  `;

  const emailParams = {
    Destination: {
      ToAddresses: [userEmail],
    },
    Message: {
      Body: {
        Text: {
          Data: `
            Thank you for your order!

            Order ID: ${orderItem.id}
            Ordered At: ${orderItem.orderedAt}
            Products: ${orderItem.productIds.join(", ")}

            We appreciate your business!
          `,
        },
      },
      Subject: {
        Data: `Order Confirmation - ${orderItem.id}`,
      },
    },
    Source: "contact@anasroud.com",
  };

  try {
    await sesClient.send(new SendEmailCommand(emailParams));
    console.log("Order confirmation email sent!");
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

async function subscribeToSNS(email) {
  if (!email || typeof email !== "string") {
    return formatResponse(400, { data: null, error: "Invalid or missing email" });
  }
  const command = new SubscribeCommand({
    Protocol: "email",
    TopicArn: SNS_TOPIC_ARN,
    Endpoint: email
  });
  try {
    const response = await snsClient.send(command);
    return formatResponse(200, { data: response, message: "Subscription request sent. Please check your email to confirm." });
  } catch (error) {
    console.error("SNS subscription error:", error);
    return formatResponse(500, { data: null, error: "Failed to subscribe email to SNS topic" });
  }
}
