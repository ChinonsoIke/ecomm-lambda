import { dynamoDB, sesClient } from "/opt/clients.js";
import { formatResponse } from "/opt/utils.js";
import { ScanCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export const handler = async (event) => {
  const { httpMethod, path, requestContext, body } = event;
  const claims = requestContext?.authorizer?.claims;
  const userId = claims?.sub;
  const email = claims?.email;

  if (!userId) return formatResponse(401, { data: null, error: "Unauthorized" });

  if (path === "/orders" && httpMethod === "GET") {
    return await getOrders(userId);
  }

  if (path === "/orders" && httpMethod === "POST") {
    const { productIds } = JSON.parse(body || "{}");
    return await placeOrder(userId, email, productIds);
  }

  return formatResponse(404, { data: null, error: "Route not found" });
};

async function getOrders(userId) {
  const command = new ScanCommand({
    TableName: "Orders",
    FilterExpression: "userId = :userId",
    ExpressionAttributeValues: { ":userId": userId }
  });

  const result = await dynamoDB.send(command);
  return formatResponse(200, { data: result.Items || [], message: "Orders fetched" });
}

async function placeOrder(userId, email, productIds) {
  const order = {
    id: Date.now().toString(36),
    userId,
    productIds,
    orderedAt: new Date().toISOString()
  };

  const putCommand = new PutCommand({
    TableName: "Orders",
    Item: order
  });

  await dynamoDB.send(putCommand);

  if (email) {
    await sendOrderConfirmationEmail(order, email);
  }

  return formatResponse(200, { data: order, message: "Order placed successfully" });
}

async function sendOrderConfirmationEmail(order, userEmail) {
  const htmlBody = `
    <html>
      <body style="font-family: Arial; padding: 20px;">
        <h2 style="color: #4CAF50;">Order Confirmation</h2>
        <p>Order ID: <strong>${order.id}</strong></p>
        <p>Ordered At: <strong>${order.orderedAt}</strong></p>
        <p>Products: ${order.productIds.map(id => `<div>${id}</div>`).join("")}</p>
      </body>
    </html>
  `;

  const emailParams = {
    Destination: { ToAddresses: [userEmail] },
    Message: {
      Body: {
        Html: { Data: htmlBody },
        Text: {
          Data: `Order ID: ${order.id}\nOrdered At: ${order.orderedAt}\nProducts: ${order.productIds.join(", ")}`
        }
      },
      Subject: { Data: `Order Confirmation - ${order.id}` }
    },
    Source: "contact@anasroud.com"
  };

  try {
    await sesClient.send(new SendEmailCommand(emailParams));
  } catch (error) {
    console.error("Failed to send confirmation email:", error);
  }
}
