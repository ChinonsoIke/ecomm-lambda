import { snsClient } from "/opt/clients.js";
import { formatResponse } from "/opt/utils.js";
import { SubscribeCommand } from "@aws-sdk/client-sns";

const SNS_TOPIC_ARN = "arn:aws:sns:us-east-2:576771098782:email-sub";

export const handler = async (event) => {
  const { httpMethod, path, body } = event;

  if (path === "/sub" && httpMethod === "POST") {
    const { email } = JSON.parse(body || "{}");
    return await subscribeEmail(email);
  }

  return formatResponse(404, { data: null, error: "Route not found" });
};

async function subscribeEmail(email) {
  if (!email || typeof email !== "string") {
    return formatResponse(400, { data: null, error: "Invalid email address" });
  }

  const command = new SubscribeCommand({
    Protocol: "email",
    TopicArn: SNS_TOPIC_ARN,
    Endpoint: email
  });

  try {
    const result = await snsClient.send(command);
    return formatResponse(200, {
      data: result,
      message: "Subscription request sent. Check your email to confirm."
    });
  } catch (error) {
    console.error("SNS subscription error:", error);
    return formatResponse(500, { data: null, error: "Failed to subscribe" });
  }
}
