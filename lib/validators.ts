import { z } from 'zod'

// Password complexity rules
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Must contain at least one number')
  .regex(/[^a-zA-Z0-9]/, 'Must contain at least one special character')

// User Login Schema
export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

// KYC Document Upload Schema (used on the client)
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

const fileValidation = z
  .any()
  .refine((files) => files && files.length > 0, 'Document is required')
  .refine((files) => !files || !files[0] || files[0].size <= MAX_FILE_SIZE, 'File size must be less than 5MB')
  .refine(
    (files) => !files || !files[0] || ALLOWED_FILE_TYPES.includes(files[0].type),
    'Only JPG, PNG, and PDF formats are allowed'
  )

// User Signup + KYC Registration Schema
export const registerSchema = z.object({
  // registration fields for account creation
  fullName: z.string().min(3, 'Full name must be at least 3 characters'),
  email: z.string().email('Please enter a valid email address'),
  phoneNumber: z.string().min(8, 'Please enter a valid phone number'),
  password: passwordSchema,
  country: z.string().min(2, 'Please specify your country'),
  address: z.string().min(5, 'Please specify your full address'),
  nidFront: fileValidation,
  nidBack: fileValidation,
  // Optional employee-specific fields
  branch: z.enum(['Rangpur', 'Dhaka', 'Sylhet', 'Custom']).optional(),
  bankName: z.string().min(2, 'Bank name required').optional(),
  bankAccount: z.string().min(5, 'Bank account required').optional(),
});

// Payment submission schema


export const signupSchema = z.object({
  fullName: z.string().min(3, 'Full name must be at least 3 characters'),
  email: z.string().email('Please enter a valid email address'),
  phoneNumber: z.string().min(8, 'Please enter a valid phone number'),
  password: passwordSchema,
});

export const paymentSchema = z.object({
  invoiceTitle: z.string().min(3, 'Invoice title must be at least 3 characters'),
  invoiceNumber: z.string().min(2, 'Invoice number must be at least 2 characters'),
  description: z.string().optional(),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  currency: z.string().default('BDT'),
  invoiceFile: fileValidation,
  paymentMethod: z.enum(['bkash', 'nagad', 'rocket', 'bank_transfer']),
  
  // Mobile details
  accountName: z.string().optional(),
  mobileNumber: z.string().optional(),

  // Bank details
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  district: z.string().optional(),
  branchName: z.string().optional(),
  swiftCode: z.string().optional(),
}).refine((data) => {
  if (['bkash', 'nagad', 'rocket'].includes(data.paymentMethod)) {
    return !!data.accountName && !!data.mobileNumber;
  }
  return true;
}, {
  message: 'Mobile account name and number are required for mobile banking',
  path: ['mobileNumber'],
}).refine((data) => {
  if (data.paymentMethod === 'bank_transfer') {
    return !!data.bankName && !!data.accountName && !!data.accountNumber && !!data.district && !!data.branchName;
  }
  return true;
}, {
  message: 'Detailed bank specifications (Bank Name, Account Name, Account Number, District, Branch) are required',
  path: ['bankName'],
})

// role-based KYC Schema
export const kycSchema = (role: 'employee' | 'partner' | 'head_office') => {
  const base = z.object({
    address: z.string().min(5, 'Address must be at least 5 characters'),
    nidFront: fileValidation,
    nidBack: fileValidation,
    selfie: fileValidation,
  });

  const employee = base.extend({
    bankAccountName: z.string().min(3, 'Account holder name required'),
    bankAccountNumber: z.string().min(5, 'Account number required'),
    bankName: z.string().min(2, 'Bank name required'),
    district: z.string().min(2, 'District required'),
  });

  const partner = base.extend({
    bankAccountName: z.string().min(3, 'Account holder name required'),
    bankAccountNumber: z.string().min(5, 'Account number required'),
    bankName: z.string().min(2, 'Bank name required'),
    district: z.string().min(2, 'District required'),
    // add any extra partner fields later if needed
  });

  // Head Office uses the same fields as employee
  if (role === 'partner') return partner;
  return employee; // covers 'employee' and 'head_office'
};
