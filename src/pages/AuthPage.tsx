import { useState } from "react";
import { AuthBanner } from "../components/auth/AuthBanner";
import { AuthForm } from "../components/auth/AuthForm";

// No `onLogin` plumbing any more: AuthForm writes the session via setAuth(),
// which notifies the route guard directly, so the guard re-renders and lets the
// user through on its own.
const AuthPage = () => {
  const [isSignIn, setIsSignIn] = useState(false);

  return (
    <div className="flex h-screen w-full font-sans bg-white overflow-hidden">
      <AuthBanner isSignIn={isSignIn} />
      <AuthForm isSignIn={isSignIn} setIsSignIn={setIsSignIn} />
    </div>
  );
};

export default AuthPage;
