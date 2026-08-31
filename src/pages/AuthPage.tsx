import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { AuthBanner } from "../components/auth/AuthBanner";
import { AuthForm } from "../components/auth/AuthForm";

// No `onLogin` plumbing any more: AuthForm writes the session via setAuth(),
// which notifies the route guard directly, so the guard re-renders and lets the
// user through on its own.
const AuthPage = () => {
  const [isSignIn, setIsSignIn] = useState(false);
  const [params] = useSearchParams();

  // Invitations used to point here, where the token was silently ignored.
  // Kept as a redirect so any link already sitting in an inbox still works.
  const token = params.get("inviteToken") || params.get("resetToken");
  if (token) {
    const key = params.get("inviteToken") ? "inviteToken" : "resetToken";
    return <Navigate to={`/set-password?${key}=${encodeURIComponent(token)}`} replace />;
  }

  return (
    <div className="flex h-screen w-full font-sans bg-white overflow-hidden">
      <AuthBanner isSignIn={isSignIn} />
      <AuthForm isSignIn={isSignIn} setIsSignIn={setIsSignIn} />
    </div>
  );
};

export default AuthPage;
