import { extractDartSymbol } from './dist/src/ast/dartCompressor.js';

const code = `class DynamicSectionCoordinator {
  static Widget _buildProductsSection(
    Map<String, dynamic> section, {
    Function(dynamic)? onAddToCart,
    Function(dynamic)? onAddToWishlist,
  }) {
    print('hello world');
    return Container();
  }
}`;

const result = extractDartSymbol(code, '_buildProductsSection', 'DynamicSectionCoordinator');
console.log('RESULT:', result);
