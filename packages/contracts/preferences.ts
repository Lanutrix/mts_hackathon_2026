export const wallboardOrders = ["priority", "deadline", "registered"] as const;
export type WallboardOrder = typeof wallboardOrders[number];
export const wallboardIntervals = [10, 18, 30] as const;

export interface AccountPreferences {
  zone: string;
  sound: boolean;
  notifications: boolean;
  wallboardOrder: WallboardOrder;
  wallboardSeconds: number;
}

export const defaultPreferences: AccountPreferences = {
  zone: "Europe/Moscow",
  sound: false,
  notifications: false,
  wallboardOrder: "priority",
  wallboardSeconds: 18,
};
