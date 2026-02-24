export const createOrder = async (req, res, next) => {
  try {
    res.status(201).json({ message: "Customer create order blueprint" });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req, res, next) => {
  try {
    res.json({ message: "Customer list orders blueprint" });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    res.json({ message: "Customer get order by id blueprint" });
  } catch (error) {
    next(error);
  }
};

export const uploadAsset = async (req, res, next) => {
  try {
    res.status(201).json({ message: "Customer upload asset blueprint" });
  } catch (error) {
    next(error);
  }
};

