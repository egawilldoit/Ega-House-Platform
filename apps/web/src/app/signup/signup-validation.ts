export type SignupFields = {
  fullName: string;
  email: string;
  password: string;
};

export type SignupFieldErrors = Partial<Record<keyof SignupFields, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSignupName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSignupEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateSignupFields(input: SignupFields): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  const fullName = normalizeSignupName(input.fullName);
  const email = normalizeSignupEmail(input.email);

  if (!fullName) {
    errors.fullName = "Enter your name.";
  } else if (fullName.length > 100) {
    errors.fullName = "Keep your name to 100 characters or fewer.";
  }

  if (!email) {
    errors.email = "Enter your email address.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (input.password.length < 12) {
    errors.password = "Use at least 12 characters for your password.";
  } else if (input.password.length > 128) {
    errors.password = "Keep your password to 128 characters or fewer.";
  }

  return errors;
}
