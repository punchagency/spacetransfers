export const listOrders = async (req, res, next) => {
  try {
    res.json({ message: "Admin list orders blueprint" });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    res.json({ message: "Admin get order by id blueprint" });
  } catch (error) {
    next(error);
  }
};

export const listPartners = async (req, res, next) => {
  try {
    res.json({ message: "Admin list partners blueprint" });
  } catch (error) {
    next(error);
  }
};

export const updatePartner = async (req, res, next) => {
  try {
    res.json({ message: "Admin update partner blueprint" });
  } catch (error) {
    next(error);
  }
};

export const getEarningsSummary = async (req, res, next) => {
  try {
    res.json({ message: "Admin earnings summary blueprint" });
  } catch (error) {
    next(error);
  }
};

