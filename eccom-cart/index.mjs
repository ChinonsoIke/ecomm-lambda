import { dynamoDB } from "/opt/clients.js";
import { formatResponse } from "/opt/utils.js";
import { ScanCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

export const handler = async (event) => {
  const { httpMethod, path, pathParameters, requestContext, body } = event;
  const claims = requestContext?.authorizer?.claims;
  const userId = claims?.sub;

  if (!userId) return formatResponse(401, { data: null, error: "Unauthorized" });

  if (path === "/cart" && httpMethod === "GET") return await getCart(userId);
  if (path === "/cart" && httpMethod === "POST") {
    const { productId } = JSON.parse(body || "{}");
    return await addToCart(userId, productId);
  }
  if (path.startsWith("/cart/") && httpMethod === "DELETE") {
    const { cartItemId } = pathParameters;
    return await deleteCartItem(userId, cartItemId);
  }

  return formatResponse(404, { data: null, error: "Route not found" });
};

async function getCart(userId) {
  const command = new ScanCommand({
    TableName: "CartItems",
    FilterExpression: "userId = :userId",
    ExpressionAttributeValues: { ":userId": userId }
  });
  const result = await dynamoDB.send(command);
  return formatResponse(200, { data: result.Items || [], message: "Cart fetched" });
}

async function addToCart(userId, productId) {
  const command = new PutCommand({
    TableName: "CartItems",
    Item: { id: Date.now().toString(36), userId, productId }
  });
  await dynamoDB.send(command);
  return formatResponse(200, { data: null, message: "Item added to cart" });
}

async function deleteCartItem(userId, cartItemId) {
  const command = new DeleteCommand({
    TableName: "CartItems",
    Key: { id: cartItemId }
  });
  await dynamoDB.send(command);
  return formatResponse(200, { data: null, message: "Item deleted from cart" });
}
