// Types of error in enumerator
export enum ErrorType {
  "INVALID_CONFIG" = "The config is invalid json type",
  "GET_USER_INPUT_FAILED" = "Error occurred while getting user input",
  "RESOLVE_JSON_FAILED" = "Error occurred while resolving res body to json",
  "GENERATE_OSDB_FAILED" = "Error occurred while generating .osdb",
  "REQUEST_DATA_FAILED" = "Error occurred while requesting data",
  "RATE_LIMITED" = "The request rate is limited.",
  "FOLDER_GENERATION_FAILED" = "Error occurred while generating folder",
  "FILE_NAME_EXTRACTION_FAILED" = "Error occurred while extracting file name",
  "MESSAGE_GENERATION_FAILED" = "Error occurred while updating monitor",
  "CORRUPTED_RESPONSE" = "The api response is corrupted",
  "MANAGE_DOWNLOAD_FAILED" = "Error occurred while processing downloads",
  "COLLECTION_DB_READ_FAILED" = "Error occurred while reading collection.db",
  "COLLECTION_DB_WRITE_FAILED" = "Error occurred while writing collection.db",
  "OSU_IS_RUNNING" = "osu! is currently running, please close it before modifying collection.db",
  "OSU_DB_NOT_FOUND" = "osu!.db file not found",
  "OSU_DB_READ_FAILED" = "Error occurred while reading osu!.db",
}

// Returns a string containing the current date, a label, the string value associated with the errorType, and the error itself
const getMessage = (type: keyof typeof ErrorType, error: string): string => {
  return `${new Date().toLocaleTimeString()} | [OcdlError]: ${type} - ${
    ErrorType[type]
  }\n${error}`;
};

export default class OcdlError extends Error {
  constructor(errorType: keyof typeof ErrorType, error: unknown) {
    // Calls the parent class' constructor and sets the message property of the OcdlError instance
    super(getMessage(errorType, String(error)));
  }
}
