from sqlalchemy import Column, Integer, Float, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func
from database import Base


class Flavor(Base):
    __tablename__ = "flavors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    category = Column(String, nullable=False, default="classics")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class Production(Base):
    __tablename__ = "production"

    id = Column(Integer, primary_key=True, index=True)
    flavor_id = Column(Integer, ForeignKey("flavors.id"), nullable=False)
    product_type = Column(String, nullable=False)  # tub, pint, quart
    quantity = Column(Integer, nullable=False)
    logged_at = Column(DateTime, server_default=func.now())
    employee_name = Column(String, nullable=True)  # Who logged this production


class DailyCount(Base):
    __tablename__ = "daily_counts"

    id = Column(Integer, primary_key=True, index=True)
    flavor_id = Column(Integer, ForeignKey("flavors.id"), nullable=False)
    product_type = Column(String, nullable=False)  # tub, pint, quart
    count = Column(Float, nullable=False)
    counted_at = Column(DateTime, server_default=func.now())
    predicted_count = Column(Float, nullable=True)  # What the system predicted
    variance = Column(Float, nullable=True)         # actual - predicted
    variance_pct = Column(Float, nullable=True)     # (variance / predicted) * 100
    employee_name = Column(String, nullable=True)   # Who submitted this count


class ParLevel(Base):
    __tablename__ = "par_levels"
    __table_args__ = (
        UniqueConstraint("flavor_id", "product_type", name="uq_par_flavor_type"),
    )

    id = Column(Integer, primary_key=True, index=True)
    flavor_id = Column(Integer, ForeignKey("flavors.id"), nullable=False)
    product_type = Column(String, nullable=False)  # tub, pint, quart
    target = Column(Integer, nullable=False, default=0)          # "Ready at open"
    minimum = Column(Integer, nullable=False, default=0)         # "Make more at"
    batch_size = Column(Float, nullable=False, default=1)        # "One batch makes"
    weekend_target = Column(Integer, nullable=True)              # "Weekend target" (Fri-Sun)
