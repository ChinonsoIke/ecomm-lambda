import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  ScanCommand,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = "us-east-2";
const dynamoDB = new DynamoDBClient({ region: REGION });
let claims = null;

export const handler = async (event) => {

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
        return await getProducts();

      case path === "/search":
        return await search(evt.searchTerm);

      case path === "/cart" && httpMethod === "POST":
        return await addToCart(evt.productId);

      case path === "/cart":
        return await getCart();

      case path === "/orders" && httpMethod === "POST":
        return await order(evt.productIds);

      case path === "/orders":
        return await getOrders();

      case path.startsWith("/products/") && httpMethod === "GET":
        const productId = path.split("/")[2];
        console.log("Product ID:", productId);
        return await getProductById(productId);

      case path === "/test":
        return {
            statusCode: 200,
            body: JSON.stringify({ testing: "latest version running" }),
        };

      default:
        return {
          statusCode: 404,
          body: JSON.stringify({ message: "Route not found" + path + " tests "}),
        };
    }
  } catch (error) {
    console.error("Unhandled Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message, stack: error.stack }),
    };
  }
};


async function getProducts() {
  try {
    const command = new ScanCommand({ TableName: "Products" });
    const result = await dynamoDB.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify(result.Items),
    };
  } catch (error) {
    console.error("Error scanning table:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to scan table" }),
    };
  }
}

async function getProductById(productId) {
  try {
    const command = new GetCommand({
      TableName: "Products",
      Key: { id: productId },
    });

    const result = await dynamoDB.send(command);

    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Product not found" }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result.Item),
    };
  } catch (error) {
    console.error("Error fetching product:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch product" + error + result + productId }),
    };
  }
}

async function search(query = "") {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing or invalid search term" }),
    };
  }

  const normalizedQuery = query.toLowerCase();

  // Scan *all* products
  const command = new ScanCommand({
    TableName: "Products",
  });

  try {
    const result = await dynamoDB.send(command);

    // Post-filter in JS
    const filtered = (result.Items || []).filter(item =>
      item.title?.toLowerCase().includes(normalizedQuery) ||
      item.description?.toLowerCase().includes(normalizedQuery)
    );

    return {
      statusCode: 200,
      body: JSON.stringify(filtered),
    };
  } catch (err) {
    console.error("Search failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Search failed" }),
    };
  }
}

async function getCart() {
  if (!claims) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" }),
    };
  }

  try {
    const getCart = new ScanCommand({
      TableName: "Carts",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": claims.sub,
      },
    });

    const cartResult = await dynamoDB.send(getCart);
    const cart = cartResult.Items?.[0];
    let id = "";

    if (!cart) {
      id = Date.now().toString(36);
      const createCart = new PutCommand({
        TableName: "Carts",
        Item: {
          id: id,
          userId: claims.sub,
        },
      });
      await dynamoDB.send(createCart);
    } else id = cart.id;

    const getCartItems = new ScanCommand({
      TableName: "CartItems",
      FilterExpression: "cartId = :cartId",
      ExpressionAttributeValues: {
        ":cartId": id,
      },
    });

    const cartItemsResult = await dynamoDB.send(getCartItems);
    const response = {
      id: id,
      userId: claims.sub,
      items: cartItemsResult.Items,
    };

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (err) {
    console.error("Get cart failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Get cart failed" }),
    };
  }
}

async function addToCart(productId) {
  if (!claims) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" }),
    };
  }

  try {
    const getCart = new ScanCommand({
      TableName: "Carts",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": claims.sub,
      },
    });

    const cartResult = await dynamoDB.send(getCart);
    const cart = cartResult.Items?.[0];
    let id = "";

    if (!cart) {
      id = Date.now().toString(36);
      const createCart = new PutCommand({
        TableName: "Carts",
        Item: {
          id: id,
          userId: claims.sub,
        },
      });
      await dynamoDB.send(createCart);
    } else id = cart.id;

    const command = new PutCommand({
      TableName: "CartItems",
      Item: {
        id: Date.now().toString(36),
        cartId: id,
        productId: productId,
      },
    });

    await dynamoDB.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Item added to cart" }),
    };
  } catch (err) {
    console.error("Add to cart failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Add to cart failed" }),
    };
  }
}

async function getOrders() {
  if (!claims) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" }),
    };
  }

  try {
    const getOrders = new ScanCommand({
      TableName: "Orders",
      FilterExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": claims.sub,
      },
    });

    const getOrdersResult = await dynamoDB.send(getOrders);
    const response = {
      userId: claims.sub,
      items: getOrdersResult.Items,
    };

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (err) {
    console.error("Get orders failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Get orders failed" }),
    };
  }
}

async function order(productIds) {
  if (!claims) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" }),
    };
  }

  const command = new PutCommand({
    TableName: "Orders",
    Item: {
      id: Date.now().toString(36),
      userId: claims.sub,
      productIds: productIds,
    },
  });

  try {
    await dynamoDB.send(command);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Order placed" }),
    };
  } catch (err) {
    console.error("Order failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Order failed" }),
    };
  }
}
