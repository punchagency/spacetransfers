import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import OrderSummary from './OrderSummary';

const mockCartItems = [
  {
    id: 1,
    name: 'Test Item 1',
    size: '10x10',
    quantity: 1,
    price: 10,
    type: 'standard'
  },
  {
    id: 2,
    name: 'Test Item 2',
    size: '20x20',
    quantity: 2,
    price: 20,
    type: 'standard'
  }
];

describe('OrderSummary', () => {
  const defaultProps = {
    cartItems: mockCartItems,
    step: 1,
    subtotal: 50,
    shippingCost: 10,
    tax: 5,
    total: 65,
    onNext: vi.fn(),
  };

  it('renders cart summary when items are present', () => {
    render(<OrderSummary {...defaultProps} />);
    
    expect(screen.getByText('Order Summary')).toBeInTheDocument();
    expect(screen.getByText('Test Item 1')).toBeInTheDocument();
    expect(screen.getByText('Test Item 2')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('$65.00')).toBeInTheDocument();
  });

  it('returns null when cart is empty', () => {
    const { container } = render(<OrderSummary {...defaultProps} cartItems={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when cartItems is undefined', () => {
    // @ts-ignore
    const { container } = render(<OrderSummary {...defaultProps} cartItems={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('displays correct item quantities and prices', () => {
    render(<OrderSummary {...defaultProps} />);
    
    expect(screen.getByText('Qty: 1')).toBeInTheDocument();
    expect(screen.getByText('Qty: 2')).toBeInTheDocument();
    
    // $10.00 appears twice (item 1 and shipping)
    const tenDollarElements = screen.getAllByText('$10.00');
    expect(tenDollarElements.length).toBe(2);
    
    expect(screen.getByText('$40.00')).toBeInTheDocument(); // 2 * 20
  });

  it('calls onNext when the button is clicked', () => {
    const onNext = vi.fn();
    render(<OrderSummary {...defaultProps} onNext={onNext} />);
    
    const button = screen.getByRole('button');
    button.click();
    
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('hides the item list at step 0', () => {
    render(<OrderSummary {...defaultProps} step={0} />);
    
    expect(screen.queryByText('Test Item 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Test Item 2')).not.toBeInTheDocument();
    expect(screen.getByText('Order Summary')).toBeInTheDocument();
  });

  it('shows different button text based on step', () => {
    const { rerender } = render(<OrderSummary {...defaultProps} step={0} />);
    expect(screen.getByText('Proceed to Checkout')).toBeInTheDocument();
    
    rerender(<OrderSummary {...defaultProps} step={1} />);
    expect(screen.getByText('Continue to Payment')).toBeInTheDocument();
    
    rerender(<OrderSummary {...defaultProps} step={2} />);
    expect(screen.getByText('Continue to Review')).toBeInTheDocument();
    
    rerender(<OrderSummary {...defaultProps} step={3} />);
    expect(screen.getByText('Place Order')).toBeInTheDocument();
  });
});
