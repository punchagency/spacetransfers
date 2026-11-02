import { AuthBanner } from "../components/auth/AuthBanner";
import { AuthForm } from "../components/auth/AuthForm";

const AuthPage = () => {
  return (
    <div className="flex min-h-screen w-full font-sans bg-white overflow-hidden">
      <AuthBanner />
      <AuthForm />
    </div>
  );
};

export default AuthPage;
