export const getCurrentUser = async (req, res, next) => {
  try {
    const user = req.user;
    const userResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    if (user.companyName) userResponse.companyName = user.companyName;
    if (user.phone) userResponse.phone = user.phone;
    if (user.defaultShippingAddress) userResponse.defaultShippingAddress = user.defaultShippingAddress;

    res.json({ user: userResponse });
  } catch (error) {
    next(error);
  }
};

