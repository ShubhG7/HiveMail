import {
  Briefcase,
  Receipt,
  GraduationCap,
  ShoppingBag,
  Newspaper,
  Users,
  Package,
  Landmark,
  Inbox,
  type LucideIcon,
} from "lucide-react";

export interface Category {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  keywords: string[];
}

export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: "hiring",
    name: "Hiring",
    description: "Job opportunities, interviews, recruiter outreach",
    icon: Briefcase,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    keywords: ["job", "interview", "position", "recruiter", "hiring", "opportunity", "resume", "linkedin"],
  },
  {
    id: "bills",
    name: "Bills",
    description: "Invoices, payment due, bills, statements",
    icon: Receipt,
    color: "text-red-600",
    bgColor: "bg-red-50",
    keywords: ["invoice", "bill", "payment", "due", "statement", "overdue", "balance"],
  },
  {
    id: "school",
    name: "School",
    description: "Education, courses, academic communications",
    icon: GraduationCap,
    color: "text-yellow-600",
    bgColor: "bg-yellow-50",
    keywords: ["course", "class", "assignment", "grade", "professor", "university", "school", "student"],
  },
  {
    id: "receipts",
    name: "Receipts",
    description: "Purchase confirmations, order receipts",
    icon: ShoppingBag,
    color: "text-green-600",
    bgColor: "bg-green-50",
    keywords: ["receipt", "order", "purchase", "confirmation", "bought", "transaction"],
  },
  {
    id: "newsletters",
    name: "Newsletters",
    description: "Marketing emails, newsletters, promotional content",
    icon: Newspaper,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    keywords: ["newsletter", "subscribe", "unsubscribe", "digest", "weekly", "update", "announcement"],
  },
  {
    id: "social",
    name: "Social",
    description: "Social media notifications, friend requests",
    icon: Users,
    color: "text-pink-600",
    bgColor: "bg-pink-50",
    keywords: ["facebook", "twitter", "instagram", "linkedin", "notification", "friend", "follow", "mention"],
  },
  {
    id: "shipping",
    name: "Shipping",
    description: "Package tracking, delivery updates",
    icon: Package,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    keywords: ["shipping", "delivery", "tracking", "shipped", "package", "ups", "fedex", "usps", "dhl"],
  },
  {
    id: "finance",
    name: "Finance",
    description: "Bank statements, investment updates, financial alerts",
    icon: Landmark,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    keywords: ["bank", "account", "transfer", "deposit", "withdrawal", "investment", "stock", "dividend"],
  },
  {
    id: "misc",
    name: "Miscellaneous",
    description: "Everything else",
    icon: Inbox,
    color: "text-gray-600",
    bgColor: "bg-gray-50",
    keywords: [],
  },
];

export function getCategoryById(id: string): Category {
  return DEFAULT_CATEGORIES.find((c) => c.id === id) || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
}

export function getCategoryColor(id: string): string {
  const category = getCategoryById(id);
  return category.color;
}

export function getCategoryBgColor(id: string): string {
  const category = getCategoryById(id);
  return category.bgColor;
}

/**
 * Simple keyword-based category suggestion (fallback when LLM unavailable)
 */
export function suggestCategoryByKeywords(
  subject: string,
  from: string,
  snippet: string
): string {
  const text = `${subject} ${from} ${snippet}`.toLowerCase();

  for (const category of DEFAULT_CATEGORIES) {
    if (category.id === "misc") continue;
    for (const keyword of category.keywords) {
      if (text.includes(keyword)) {
        return category.id;
      }
    }
  }

  return "misc";
}

/**
 * Priority labels
 */
export const PRIORITY_LABELS = {
  LOW: { label: "Low", color: "text-gray-500", bgColor: "bg-gray-100" },
  NORMAL: { label: "Normal", color: "text-blue-500", bgColor: "bg-blue-100" },
  HIGH: { label: "High", color: "text-orange-500", bgColor: "bg-orange-100" },
  URGENT: { label: "Urgent", color: "text-red-500", bgColor: "bg-red-100" },
};

export type PriorityLevel = keyof typeof PRIORITY_LABELS;
