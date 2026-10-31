class ApiException implements Exception {
  final int statusCode;
  final String message;
  final String? code;
  const ApiException(this.statusCode, this.message, {this.code});
  @override
  String toString() => message;
}
