import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SNSClient } from "@aws-sdk/client-sns";
import { SESClient } from "@aws-sdk/client-ses";

const REGION = "us-east-2";

export const dynamoDB = new DynamoDBClient({ region: REGION });
export const snsClient = new SNSClient({ region: REGION });
export const sesClient = new SESClient({ region: REGION });
