import '../../../../core/services/api_service.dart';
import '../../../../injection_container.dart' as di;
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_fonts/google_fonts.dart';
import '../bloc/wallet_bloc.dart';
import '../bloc/wallet_event.dart';
import '../bloc/wallet_state.dart';
import '../../data/models/transaction_model.dart';
import 'package:goride_driver_app/features/auth/presentation/bloc/auth_bloc.dart' as goride_auth;
import 'package:goride_driver_app/features/auth/presentation/bloc/auth_state.dart' as goride_auth;

class WalletPage extends StatefulWidget {
  const WalletPage({super.key});

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> with WidgetsBindingObserver {
  WalletLoaded? _lastWallet;
  bool _checkoutAvailable = false;
  String _paymentNotice = 'Checking online payment availability…';
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refreshWallet();
  }

  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); super.dispose(); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshWallet();
  }
  Future<void> _checkPayments() async {
    try {
      final data = await di.sl<ApiService>().get('/wallet/methods');
      if (!mounted) return;
      setState(() {
        _checkoutAvailable = data['onlineCheckoutAvailable'] == true;
        _paymentNotice = _checkoutAvailable
          ? 'Secure checkout: available payment methods are shown by the provider.'
          : 'Online payments await merchant setup. No fake top-ups. Bank payouts are not enabled.';
      });
    } catch (_) {
      if (mounted) setState(() { _checkoutAvailable = false; _paymentNotice = 'Payment availability could not be verified. No payment will be initiated.'; });
    }
  }

  void _refreshWallet() {
    _checkPayments();
    final authState = context.read<goride_auth.AuthBloc>().state;
    if (authState.userId.isNotEmpty) {
      context.read<WalletBloc>().add(FetchWalletData(authState.userId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = context.watch<goride_auth.AuthBloc>().state;
    String driverId = authState.userId;

    return BlocListener<WalletBloc, WalletState>(
        listener: (context, state) {
          if (state is PaymentCheckoutOpened) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Complete payment in the browser. Return and refresh; only verified funds are credited.')));
          } else if (state is PayoutSuccess) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.message), backgroundColor: Colors.green),
            );
          } else if (state is WalletError) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.message), backgroundColor: Colors.red),
            );
          }
        },
        child: Scaffold(
          backgroundColor: const Color(0xff0a0a0a),
          body: SafeArea(
            child: BlocBuilder<WalletBloc, WalletState>(
              builder: (context, state) {
                if (state is WalletLoading) {
                  return const Center(child: CircularProgressIndicator(color: Color(0xff76eb07)));
                }

                if (state is WalletLoaded) _lastWallet = state;
                double balance = _lastWallet?.balance ?? 0.0;
                List<TransactionModel> transactions = _lastWallet?.transactions ?? [];

                if (state is WalletLoaded) {
                  balance = state.balance;
                  transactions = state.transactions;
                }

                return RefreshIndicator(
                  onRefresh: () async {
                    _refreshWallet();
                  },
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: 25),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 20),
                        _buildHeader(context, driverId),
                        const SizedBox(height: 12),
                        Text(_paymentNotice, style: const TextStyle(color: Colors.white60, fontSize: 12)),
                        const SizedBox(height: 30),
                        _buildBalanceCard(balance),
                        const SizedBox(height: 40),
                        _buildSectionHeader("Financial Actions"),
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            Expanded(
                              child: _buildActionBtn(
                                "Withdraw",
                                Icons.file_upload_outlined,
                                const Color(0xff76eb07),
                                onTap: () => _showPayoutDialog(context, driverId, balance),
                              ),
                            ),
                          const SizedBox(width: 15),
                          Expanded(
                            child: _buildActionBtn(
                              "Top Up",
                              Icons.add_circle_outline_rounded,
                              Colors.white10,
                              isSecondary: true,
                              onTap: () { if (_checkoutAvailable) { _showTopUpDialog(context, driverId); } else { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_paymentNotice))); } },
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 40),
                      _buildSectionHeader("Recent Transactions"),
                      const SizedBox(height: 20),
                      if (transactions.isEmpty)
                        Center(
                          child: Padding(
                            padding: const EdgeInsets.only(top: 20),
                            child: Text(
                              "No transactions yet",
                              style: GoogleFonts.outfit(color: Colors.white24),
                            ),
                          ),
                        )
                      else
                        ...transactions.map((tx) => _buildTransactionItem(
                              tx.title,
                              tx.subTitle,
                              "${tx.isNegative ? '-' : '+'}Rs. ${tx.amount}",
                              tx.date.split('T')[0],
                              isNegative: tx.isNegative,
                            )),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _showTopUpDialog(BuildContext context, String driverId) async {
    final amountController = TextEditingController();
    await showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(
      title: const Text('Add money (INR)'),
      content: TextField(controller: amountController,keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: const InputDecoration(labelText: 'Amount — INR 1 to 10,000')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext),child: const Text('Cancel')),
        FilledButton(onPressed: () {
          final amount = double.tryParse(amountController.text);
          if (amount == null || !amount.isFinite || amount < 1 || amount > 10000) return;
          context.read<WalletBloc>().add(TopUpWallet(userId: driverId, amount: amount));
          Navigator.pop(dialogContext);
        },child: const Text('Continue to secure checkout')),
      ],
    ));
    amountController.dispose();
  }

  Widget _buildHeader(BuildContext context, String driverId) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Earnings & Wallet",
              style: GoogleFonts.outfit(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              "Track your income and payouts",
              style: GoogleFonts.outfit(
                color: Colors.white54,
                fontSize: 14,
              ),
            ),
          ],
        ),
        IconButton(
          onPressed: () => _refreshWallet(),
          icon: const Icon(Icons.refresh, color: Color(0xff76eb07)),
        ),
      ],
    );
  }

  Widget _buildBalanceCard(double balance) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(30),
      decoration: BoxDecoration(
        color: const Color(0xff76eb07),
        borderRadius: BorderRadius.circular(35),
        boxShadow: [
          BoxShadow(
            color: const Color(0xff76eb07).withValues(alpha: 0.2),
            blurRadius: 30,
            offset: const Offset(0, 15),
          ),
        ],
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(0xff76eb07),
            const Color(0xff76eb07).withValues(alpha: 0.8),
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                "Current Balance",
                style: GoogleFonts.outfit(
                  color: Colors.black54,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Icon(Icons.wallet_rounded, color: Colors.black87),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            "Rs. ${balance.toStringAsFixed(2)}",
            style: GoogleFonts.outfit(
              color: Colors.black,
              fontSize: 40,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: GoogleFonts.outfit(
        color: Colors.white,
        fontSize: 18,
        fontWeight: FontWeight.bold,
      ),
    );
  }

  Widget _buildActionBtn(String label, IconData icon, Color color,
      {bool isSecondary = false, VoidCallback? onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 20),
        decoration: BoxDecoration(
          color: isSecondary ? Colors.white.withValues(alpha: 0.05) : color,
          borderRadius: BorderRadius.circular(25),
          border: isSecondary
              ? Border.all(color: Colors.white.withValues(alpha: 0.1))
              : null,
        ),
        child: Column(
          children: [
            Icon(icon, color: isSecondary ? Colors.white : Colors.black, size: 28),
            const SizedBox(height: 10),
            Text(
              label,
              style: GoogleFonts.outfit(
                color: isSecondary ? Colors.white : Colors.black,
                fontSize: 14,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTransactionItem(
      String title, String sub, String amount, String date,
      {bool isNegative = false}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 15),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xff121212),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.03)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: (isNegative ? Colors.red : const Color(0xff76eb07))
                  .withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              isNegative ? Icons.north_east_rounded : Icons.south_west_rounded,
              color: isNegative ? Colors.red : const Color(0xff76eb07),
              size: 20,
            ),
          ),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.outfit(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  sub,
                  style: GoogleFonts.outfit(
                    color: Colors.white38,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                amount,
                style: GoogleFonts.outfit(
                  color: isNegative
                      ? Colors.redAccent
                      : const Color(0xff76eb07),
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                date,
                style: GoogleFonts.outfit(
                  color: Colors.white24,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showPayoutDialog(BuildContext context, String userId, double currentBalance) {
    final TextEditingController amountController = TextEditingController();
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: const Color(0xff1a1a1a),
        title: Text(
          "Request Payout",
          style: GoogleFonts.outfit(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Available: Rs. ${currentBalance.toStringAsFixed(2)}",
              style: GoogleFonts.outfit(color: const Color(0xff76eb07)),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: amountController,
              keyboardType: TextInputType.number,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: "Enter amount (Min. Rs. 500)",
                hintStyle: const TextStyle(color: Colors.white24),
                filled: true,
                fillColor: Colors.black,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(15),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text("Cancel", style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            onPressed: () {
              final amount = double.tryParse(amountController.text);
              if (amount != null && amount >= 500 && amount <= currentBalance) {
                context.read<WalletBloc>().add(RequestPayout(userId: userId, amount: amount));
                Navigator.pop(dialogContext);
              } else if (amount != null && amount > currentBalance) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text("Insufficient balance")),
                );
              } else {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text("Minimum payout is Rs. 500")),
                );
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xff76eb07),
              foregroundColor: Colors.black,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
            ),
            child: const Text("Request Payout"),
          ),
        ],
      ),
    );
  }
}
