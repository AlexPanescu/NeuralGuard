export function readCurrentUser() {
  try {
    const stored = localStorage.getItem("currentUser");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function readCurrentUserId() {
  const currentUser = readCurrentUser();
  return currentUser?.id || currentUser?._id || "";
}

export function readCurrentUserRole() {
  const currentUser = readCurrentUser();
  const rawRole = currentUser?.role || currentUser?.user_role || "customer";
  return typeof rawRole === "string" ? rawRole.trim().toLowerCase() : "customer";
}

export function readCurrentUserName() {
  const currentUser = readCurrentUser();
  return (
    currentUser?.name ||
    currentUser?.username ||
    currentUser?.fullName ||
    currentUser?.email ||
    "Guest"
  );
}

export function isOperatorRole(role = readCurrentUserRole()) {
  return role === "employee";
}
