import { ENV } from "../enums/Enum";
import { v4 as uuidv4 } from 'uuid';
const { Development } = ENV;

class Utilities {
  static Print = console.log;
  static getNodeEnv = (): string => process.env.NODE_ENV || Development;
  static isDevelopment = (): boolean => this.getNodeEnv() === Development;
  static messageGenerater = (msg: any) => {
    return {
      message: msg
    };
  };
  
  // Create a unique file path to handle concurrent downloads
  static createUniqueFilePath = (basePath: string, title: string, extension: string): string => {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const uniqueId = uuidv4().split('-')[0]; // Use part of UUID for uniqueness
    return `${basePath}/${safeTitle}_${uniqueId}.${extension}`;
  };
}

export default Utilities;
