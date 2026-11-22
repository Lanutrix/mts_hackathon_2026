export const intakeByteLimit = 20 * 1024 * 1024;
export const intakeRecordLimit = 20_000;

export interface IntakeReceipt {
  namespace: string;
  revision: number;
  added: string[];
  existing: string[];
}
