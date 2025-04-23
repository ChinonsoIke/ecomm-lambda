import { dynamoDB } from "clients";
import { formatResponse } from "utils";
import {
  ScanCommand,
  PutCommand,
  GetCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";

let claims = null;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return formatResponse(200, {});
  }

  try {
    claims = event.requestContext?.authorizer?.claims;
    const evt = event.body && event.body !== "" ? JSON.parse(event.body) : {};

    const path = event.rawPath || event.path || "";
    const httpMethod = event.httpMethod || "";

    switch (true) {
      case path === "/cart" && httpMethod === "POST":
        return await addToCart(evt.productId);
      case path.startsWith("/cart/") && httpMethod === "DELETE":
        const cartItemId = event.pathParameters?.cartItemId;
        return await deleteCartItem(cartItemId);
      case path === "/cart" && httpMethod === "DELETE":
        return await clearCart();
      case path === "/cart" && httpMethod === "GET":
        return await getCart();
      case path === "/test":
        return formatResponse(200, { data: { testing: "cart version running" }, message: "Cart test route working" });
      default:
        return formatResponse(404, { data: null, error: "Route not found " + path });
    }
  } catch (error) {
    console.error("Unhandled Error:", error);
    return formatResponse(500, { data: null, error: error.message });
  }
};

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
