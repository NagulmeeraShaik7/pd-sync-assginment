import dotenv from "dotenv";
import axios, { AxiosError } from "axios";
import { get } from "lodash";
import type { PipedrivePerson } from "./types/pipedrive";
import inputData from "./mappings/inputData.json";
import mappings from "./mappings/mappings.json";

// Load environment variables
dotenv.config();

// Constants for Pipedrive API configuration
const API_KEY = process.env.PIPEDRIVE_API_KEY;
const COMPANY_DOMAIN = process.env.PIPEDRIVE_COMPANY_DOMAIN;
const BASE_URL = process.env.BASE_URL || `https://${COMPANY_DOMAIN}.pipedrive.com/v1`;

// Interfaces
interface Mapping {
  pipedriveKey: string;
  inputKey: string;
}

interface PipedriveErrorResponse {
  success: boolean;
  error?: string;
  errorCode?: number;
}

/**
 * Formats error messages for consistent logging and throwing.
 * @param context - The operation context (e.g., "search for person").
 * @param error - The caught error (AxiosError or generic Error).
 * @returns Formatted error message.
 */
const formatError = (context: string, error: AxiosError<PipedriveErrorResponse> | Error): string => {
  if (error instanceof AxiosError) {
    return `${context}: ${error.response?.data?.error || error.message || "Unknown API error"}`;
  }
  return `${context}: ${error.message || "Unknown error"}`;
};

/**
 * Searches for a Pipedrive person by name.
 * @param name - The name to search for.
 * @returns The found PipedrivePerson or null if not found.
 * @throws Error if the API request fails or configuration is invalid.
 */
const findPersonByName = async (name: string): Promise<PipedrivePerson | null> => {
  if (!API_KEY || !COMPANY_DOMAIN) {
    throw new Error("Missing PIPEDRIVE_API_KEY or PIPEDRIVE_COMPANY_DOMAIN in .env file");
  }

  try {
    const { data } = await axios.get<{ data: { items: { item: PipedrivePerson }[] } }>(
      `${BASE_URL}/persons/search`,
      {
        params: { term: name, fields: "name", exact_match: true, api_token: API_KEY },
      }
    );
    return data.data?.items[0]?.item ?? null;
  } catch (error) {
    throw new Error(formatError("Failed to search for person", error as AxiosError<PipedriveErrorResponse>));
  }
};

/**
 * Creates or updates a Pipedrive person.
 * @param personData - The person data to create or update.
 * @param personId - The ID of the person to update (optional).
 * @returns The created or updated PipedrivePerson.
 * @throws Error if the API request fails.
 */
const createOrUpdatePerson = async (
  personData: Partial<PipedrivePerson>,
  personId?: number
): Promise<PipedrivePerson> => {
  const method = personId ? "put" : "post";
  const url = personId ? `${BASE_URL}/persons/${personId}` : `${BASE_URL}/persons`;

  try {
    const { data } = await axios<{ data: PipedrivePerson }>({
      method,
      url,
      params: { api_token: API_KEY },
      data: personData,
    });
    return data.data;
  } catch (error) {
    throw new Error(
      formatError(`Failed to ${personId ? "update" : "create"} person`, error as AxiosError<PipedriveErrorResponse>)
    );
  }
};

/**
 * Syncs input data to a Pipedrive person using mappings.
 * Updates an existing person or creates a new one based on name.
 * @returns The synced PipedrivePerson.
 * @throws Error for invalid configuration, missing data, or API failures.
 */
const syncPdPerson = async (): Promise<PipedrivePerson> => {
  try {
    // Validate name mapping
    const nameMapping = mappings.find((m: Mapping) => m.pipedriveKey === "name");
    if (!nameMapping) {
      throw new Error("No mapping found for 'name' in mappings.json");
    }

    // Validate name value
    const nameValue = get(inputData, nameMapping.inputKey);
    if (!nameValue || typeof nameValue !== "string") {
      throw new Error(`Invalid or missing value for inputKey '${nameMapping.inputKey}' in inputData.json`);
    }

    // Build person payload
    const personData: Partial<PipedrivePerson> = mappings.reduce((acc, { pipedriveKey, inputKey }) => {
      const value = get(inputData, inputKey);
      if (value !== undefined && value !== null) {
        acc[pipedriveKey] =
          pipedriveKey === "email" || pipedriveKey === "phone"
            ? [{ value, primary: true, label: pipedriveKey === "email" ? "work" : "home" }]
            : value;
      }
      return acc;
    }, {} as Partial<PipedrivePerson>);

    // Check for existing person and create/update
    const existingPerson = await findPersonByName(nameValue);
    return await createOrUpdatePerson(personData, existingPerson?.id);
  } catch (error) {
    throw new Error(formatError("Error in syncPdPerson", error as Error));
  }
};

// Execute and log result
syncPdPerson()
  .then((person) => console.log("Synced Person:", person))
  .catch((error) => console.error("Sync failed:", error.message));